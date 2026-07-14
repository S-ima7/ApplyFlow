import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { GOOGLE_AUTH_SCOPES } from "@/lib/google-calendar";
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
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "missing-google-secret",
      authorization: {
        params: {
          scope: GOOGLE_AUTH_SCOPES,
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (user.id && account?.provider === "google" && account.providerAccountId) {
        await prisma.account.updateMany({
          where: {
            userId: user.id,
            provider: "google",
            providerAccountId: account.providerAccountId
          },
          data: {
            access_token: account.access_token ?? undefined,
            refresh_token: account.refresh_token ?? undefined,
            expires_at: account.expires_at ?? undefined,
            token_type: account.token_type ?? undefined,
            scope: account.scope ?? undefined,
            id_token: account.id_token ?? undefined,
            session_state:
              typeof account.session_state === "string" ? account.session_state : undefined
          }
        });
      }

      return true;
    },
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
