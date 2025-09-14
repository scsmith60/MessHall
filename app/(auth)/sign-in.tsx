// app/sign-in.tsx
// 🧸 What this does:
// If any part of your app tries to go to /sign-in, we quietly send them to /login.
// We use <Redirect> because it doesn't cause setState loops.

import { Redirect } from "expo-router";

export default function SignInAlias() {
  // 🚪 Send anyone coming to /sign-in straight to /login
  return <Redirect href="/login" />;
}
