import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "database"
  },
  pages: {
    signIn: "/login"
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "missing-google-client-id",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "missing-google-secret"
    })
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.timezone =
          (user as { timezone?: string }).timezone ?? "Asia/Tokyo";
      }

      return session;
    }
  }
});
