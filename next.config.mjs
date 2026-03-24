import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  customWorkerDir: "worker",
  disable: process.env.NODE_ENV === "development",
  dynamicStartUrl: false,
  register: true,
  skipWaiting: true,
  fallbacks: {
    document: "/offline"
  }
});

const nextConfig = {
  output: "export",
  reactStrictMode: true,
  images: {
    unoptimized: true
  }
};

export default withPWA(nextConfig);
