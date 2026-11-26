"""Export pinned Real-ESRGAN checkpoints to dynamic NCHW ONNX.

Run with torch, numpy and onnx installed. Pass a directory containing the
three author checkpoints, named general.pth, anime.pth and plus.pth.
"""
import argparse
import hashlib
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
import torch

CHECKPOINTS = {
    'general': '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292',
    'anime': 'b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d',
    'plus': '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1',
}


def export(checkpoint, name, target):
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != CHECKPOINTS[name]:
        raise ValueError(f'Unexpected checkpoint digest: {checkpoint}')
    state = torch.load(checkpoint, map_location='cpu', weights_only=True)
    weights = state.get('params_ema', state.get('params'))
    nodes, initializers = [], []

    def constant(key, value):
        initializers.append(numpy_helper.from_array(np.asarray(value, dtype=np.float32), key))
        return key

    def op(kind, *inputs, output=None, **attributes):
        output = output or f'value_{len(nodes)}'
        nodes.append(helper.make_node(kind, inputs, [output], **attributes))
        return output

    def conv(value, key):
        weight = constant(f'{key}.weight', weights[f'{key}.weight'].numpy())
        bias = constant(f'{key}.bias', weights[f'{key}.bias'].numpy())
        return op('Conv', value, weight, bias, kernel_shape=[3, 3], pads=[1, 1, 1, 1])

    def resize(value, factor):
        key = f'scale{factor}'
        if not any(t.name == key for t in initializers):
            constant(key, [1, 1, factor, factor])
        return op('Resize', value, '', key, mode='nearest',
                  coordinate_transformation_mode='asymmetric', nearest_mode='floor')

    if name == 'plus':
        # RRDBNet from BasicSR. Both residuals in a block have scale 0.2.
        scale = constant('residual_scale', 0.2)
        first = value = conv('input', 'conv_first')
        for block in range(23):
            skip = value
            for dense in range(1, 4):
                parts = [value]
                for layer in range(1, 6):
                    key = f'body.{block}.rdb{dense}.conv{layer}'
                    inputs = parts[0] if len(parts) == 1 else op('Concat', *parts, axis=1)
                    next_value = conv(inputs, key)
                    if layer < 5:
                        parts.append(op('LeakyRelu', next_value, alpha=0.2))
                value = op('Add', value, op('Mul', next_value, scale))
            value = op('Add', skip, op('Mul', value, scale))
        value = op('Add', first, conv(value, 'conv_body'))
        for layer in ['conv_up1', 'conv_up2', 'conv_hr']:
            if layer != 'conv_hr':
                value = resize(value, 2)
            value = op('LeakyRelu', conv(value, layer), alpha=0.2)
        op('Identity', conv(value, 'conv_last'), output='output')
    else:
        # SRVGGNetCompact from Real-ESRGAN. CRD matches torch PixelShuffle.
        value = 'input'
        last = 2 * (33 if name == 'general' else 17)
        for index in range(0, last + 1, 2):
            value = conv(value, f'body.{index}')
            if index != last:
                key = f'body.{index + 1}.weight'
                slope = constant(key, weights[key].numpy().reshape(64, 1, 1))
                value = op('PRelu', value, slope)
        value = op('DepthToSpace', value, blocksize=4, mode='CRD')
        op('Add', value, resize('input', 4), output='output')

    graph = helper.make_graph(nodes, name, [
        helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, 3, 'height', 'width']),
    ], [
        helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 3, 'height4', 'width4']),
    ], initializer=initializers)
    model = helper.make_model(graph, ir_version=8, opset_imports=[helper.make_opsetid('', 13)],
                              producer_name='FileKit')
    onnx.checker.check_model(model)
    onnx.save(model, target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoints', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(exist_ok=True, parents=True)
    for model_name in CHECKPOINTS:
        export(args.checkpoints / f'{model_name}.pth', model_name, args.output / f'{model_name}.onnx')
