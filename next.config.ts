import type { NextConfig } from "next";
import { environmentError } from './src/lib/environment-safety';

const configError = environmentError(process.env);
if (configError) throw new Error(configError);

const nextConfig: NextConfig = {
  allowedDevOrigins: ['grandbook-staging-test.loca.lt'],
};

export default nextConfig;
