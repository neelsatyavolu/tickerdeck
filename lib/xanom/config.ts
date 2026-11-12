import { required } from "../env";

/** Settings for Xanom sign-in. Read where used, so builds and tests don't need them. */
export type XanomConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
};

const DEFAULT_ISSUER = "https://accounts.xanom.co";

export function xanomConfig(): XanomConfig {
  return {
    issuer: (process.env.XANOM_ISSUER || DEFAULT_ISSUER).replace(/\/+$/, ""),
    clientId: required("XANOM_CLIENT_ID"),
    clientSecret: required("XANOM_CLIENT_SECRET"),
  };
}

/** Where people manage their Xanom account. */
export const XANOM_HOME = DEFAULT_ISSUER;
