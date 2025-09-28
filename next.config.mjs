/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build standalone output for Docker runtime
  output: 'standalone',

  // Allow streaming responses
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

export default nextConfig
