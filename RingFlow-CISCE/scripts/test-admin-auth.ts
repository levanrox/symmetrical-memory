import { signInWithAdminPassword } from "../src/actions/auth";

async function test() {
  console.log("--- Testing Correct Password ---");
  const ok = await signInWithAdminPassword({
    email: "admin@ringflow.org",
    password: "admin123",
  });
  console.log("Correct result:", ok);

  console.log("--- Testing Wrong Password ---");
  const bad = await signInWithAdminPassword({
    email: "admin@ringflow.org",
    password: "wrongpassword",
  });
  console.log("Wrong password result:", bad);

  console.log("--- Testing Nonexistent User ---");
  const unknown = await signInWithAdminPassword({
    email: "unknown@user.com",
    password: "admin123",
  });
  console.log("Unknown user result:", unknown);

  process.exit(0);
}

test();
