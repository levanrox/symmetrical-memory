/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API address is derived from the page's own hostname at runtime, so the
  // same build works on any venue network without being rebuilt.
};

export default nextConfig;
