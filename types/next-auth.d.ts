import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      timezone: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    timezone: string;
  }
}
