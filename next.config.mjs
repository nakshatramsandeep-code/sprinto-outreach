/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["cheerio"],
  // The Learning page lives at /learn. The old address keeps working.
  async redirects() {
    return [{ source: "/learning", destination: "/learn", permanent: false }];
  },
};
export default nextConfig;
