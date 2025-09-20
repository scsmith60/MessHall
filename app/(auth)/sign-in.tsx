// app/sign-in.tsx
// 🧸 like I'm 5: if anything tries to open /sign-in,
// we quietly send them to /login.

import { Redirect } from "expo-router";

export default function SignInAlias() {
  return <Redirect href="/login" />;
}
