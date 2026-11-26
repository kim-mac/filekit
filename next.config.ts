import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import preview from './serve.json';

export default function configure(phase: string): NextConfig {
  return {
    output: 'export',
    trailingSlash: true,
    ...(phase === PHASE_DEVELOPMENT_SERVER && {
      async headers() {
        return [{ source: '/:path*', headers: preview.headers[0].headers }];
      },
    }),
  };
}
