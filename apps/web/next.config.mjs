/** @type {import('next').NextConfig} */
const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://localhost:4000';

const nextConfig = {
  allowedDevOrigins: ['*.trycloudflare.com'],
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }

    return [
      {
        source: '/api/admin/:path*',
        destination: `${apiProxyTarget}/api/admin/:path*`
      },
      {
        source: '/api/track/:path*',
        destination: `${apiProxyTarget}/api/track/:path*`
      }
    ];
  }
};

export default nextConfig;
