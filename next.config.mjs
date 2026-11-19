/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["cheerio"],
  // The Learning page lives at /learn. The old address keeps working.
  async redirects() {
    return [
      { source: "/learning", destination: "/learn", permanent: false },
      // browsers ask for /favicon.ico by default; the icon lives at /icon.svg
      { source: "/favicon.ico", destination: "/icon.svg", permanent: false },
    ];
  },
};
export default nextConfig;
