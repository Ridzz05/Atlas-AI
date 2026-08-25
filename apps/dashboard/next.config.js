/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@atlas/shared', '@atlas/agents']
};

module.exports = nextConfig;
