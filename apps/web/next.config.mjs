import { prepareMapWorkerAssets } from './scripts/prepare-map-worker.mjs';

prepareMapWorkerAssets();

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  distDir: process.env.PRODUCT_ACCEPTANCE_DIST_DIR ?? '.next',
};

export default nextConfig;
