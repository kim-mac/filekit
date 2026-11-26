import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Licenses · FileKit' };

const licenses = [
  { name: 'bg0 browser library', license: 'bg0-Apache-2.0.txt', terms: 'Apache-2.0' },
  { name: 'BiRefNet Full, Lite and iOS Lite', license: 'BiRefNet-MIT.txt', terms: 'MIT' },
  { name: 'Transformers.js', license: 'Transformers-Apache-2.0.txt', terms: 'Apache-2.0' },
  { name: 'ONNX Runtime Web', license: 'ONNX-Runtime-MIT.txt', terms: 'MIT' },
];

export default function LicensesPage() {
  return (
    <main className="home">
      <Link href="/" prefetch={false}>FileKit home</Link>
      <h1>Licenses</h1>
      <p>FileKit is available under the MIT license.</p>
      <h2>Background removal</h2>
      <ul>
        {licenses.map(({ name, license, terms }) => (
          <li key={name}><a href={`/licenses/${license}`}>{name} · {terms}</a></li>
        ))}
      </ul>
      <h2>Face detection</h2>
      <ul>
        <li><a href="/face-models/YuNet-MIT.txt">YuNet weights · MIT</a></li>
      </ul>
      <h2>Upscale</h2>
      <ul>
        <li><a href="/licenses/Real-ESRGAN-BSD-3-Clause.txt">Real-ESRGAN General and Anime · BSD-3-Clause</a></li>
        <li><a href="/licenses/ONNX-Runtime-MIT.txt">ONNX Runtime Web · MIT</a></li>
      </ul>
      <p><a href="/licenses/THIRD_PARTY_NOTICES.md">Third-party notices and model attribution</a></p>
      <p><a href="/licenses/ONNX-Runtime-ThirdPartyNotices.txt">ONNX Runtime third-party notices</a></p>
      <p><a href="/licenses/FileKit-MIT.txt">FileKit license</a></p>
    </main>
  );
}
