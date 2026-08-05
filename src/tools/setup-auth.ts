import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { run } from '../lib/run-command.js';
import { USER_SCHEMA_SOURCE } from '../auth-lib/user-schema.js';

function writeUserSchema(targetDir: string): void {
  const authDir = join(targetDir, 'libs', 'features', 'auth');
  mkdirSync(authDir, { recursive: true });
  writeFileSync(join(authDir, 'user.schema.ts'), USER_SCHEMA_SOURCE);
}

function writeEnvExample(targetDir: string, providers: IdentityProviders): void {
  const lines = [
    '# Clerk publishable key (client-side) — get this from your Clerk Dashboard.',
    'VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    '',
  ];
  if (providers.google) {
    lines.push(
      '# Google sign-in: configured in Clerk Dashboard > User & Authentication > Social',
      '# Connections — no separate app-level env var needed, Clerk handles the OAuth app.',
      '',
    );
  }
  if (providers.github) {
    lines.push(
      '# GitHub sign-in: configured in Clerk Dashboard > User & Authentication > Social',
      '# Connections — no separate app-level env var needed, Clerk handles the OAuth app.',
      '',
    );
  }
  if (providers.email === 'magic-link') {
    lines.push(
      '# Email link sign-in: enable "Email verification link" under Clerk Dashboard >',
      '# User & Authentication > Email, phone, username.',
      '',
    );
  }
  writeFileSync(join(targetDir, '.env.example'), lines.join('\n'));
}

function wireClerkProvider(appDir: string): void {
  const mainPath = join(appDir, 'src', 'main.tsx');
  let main = readFileSync(mainPath, 'utf-8');
  if (main.includes('ClerkProvider')) return;

  main = `import { ClerkProvider } from '@clerk/react';\n` + main;

  const publishableKeyLine =
    `const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;\n` +
    `if (!CLERK_PUBLISHABLE_KEY) {\n  throw new Error('Add VITE_CLERK_PUBLISHABLE_KEY to your .env file (see .env.example).');\n}\n\n`;

  // Wrap whatever the app already renders (App, StrictMode, etc.) in ClerkProvider.
  main = main.replace(
    /root\.render\(\s*([\s\S]*?)\s*,?\s*\);/,
    (_match, inner: string) => `${publishableKeyLine}root.render(\n  <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>\n    ${inner.trim()}\n  </ClerkProvider>,\n);`,
  );
  writeFileSync(mainPath, main);
}

function writeSignInScreen(authDir: string, providers: IdentityProviders): void {
  const oauthButtons: string[] = [];
  if (providers.google) {
    oauthButtons.push(
      `      <button onClick={() => signIn.sso({ strategy: 'oauth_google', redirectCallbackUrl: '/sso-callback', redirectUrl: '/' })}>Sign in with Google</button>`,
    );
  }
  if (providers.github) {
    oauthButtons.push(
      `      <button onClick={() => signIn.sso({ strategy: 'oauth_github', redirectCallbackUrl: '/sso-callback', redirectUrl: '/' })}>Sign in with GitHub</button>`,
    );
  }

  const emailBlock =
    providers.email === 'magic-link'
      ? `  const [verifying, setVerifying] = useState(false);\n\n` +
        `  const handleEmailLink = async (e: FormEvent) => {\n` +
        `    e.preventDefault();\n` +
        `    const protocol = window.location.protocol;\n` +
        `    const host = window.location.host;\n` +
        `    const { error } = await signIn.emailLink.sendLink({\n` +
        `      emailAddress,\n` +
        `      verificationUrl: \`\${protocol}//\${host}/sign-in/verify\`,\n` +
        `    });\n` +
        `    if (error) return;\n` +
        `    setVerifying(true);\n` +
        `    await signIn.emailLink.waitForVerification();\n` +
        `  };\n\n` +
        `  if (verifying) {\n` +
        `    return <p>Check your email and click the sign-in link.</p>;\n` +
        `  }\n\n`
      : `  const [password, setPassword] = useState('');\n\n` +
        `  const handlePassword = async (e: FormEvent) => {\n` +
        `    e.preventDefault();\n` +
        `    const { error } = await signIn.password({ emailAddress, password });\n` +
        `    if (error) return;\n` +
        `    if (signIn.status === 'complete') await signIn.finalize({ navigate: () => {} });\n` +
        `  };\n\n`;

  const emailForm =
    providers.email === 'magic-link'
      ? `      <form onSubmit={handleEmailLink}>\n` +
        `        <input type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="Email" />\n` +
        `        <button type="submit">Send sign-in link</button>\n` +
        `      </form>\n`
      : `      <form onSubmit={handlePassword}>\n` +
        `        <input type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="Email" />\n` +
        `        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />\n` +
        `        <button type="submit">Sign in</button>\n` +
        `      </form>\n`;

  const source =
    `import { type FormEvent, useState } from 'react';\n` +
    `import { useSignIn } from '@clerk/react';\n\n` +
    `export function SignIn() {\n` +
    `  const { signIn } = useSignIn();\n` +
    `  const [emailAddress, setEmailAddress] = useState('');\n\n` +
    emailBlock +
    `  return (\n` +
    `    <div>\n` +
    `      <h1>Sign in</h1>\n` +
    emailForm +
    (oauthButtons.length > 0 ? oauthButtons.join('\n') + '\n' : '') +
    `    </div>\n` +
    `  );\n` +
    `}\n`;

  writeFileSync(join(authDir, 'sign-in.tsx'), source);
}

function writeSignUpScreen(authDir: string): void {
  const source =
    `import { type FormEvent, useState } from 'react';\n` +
    `import { useSignUp } from '@clerk/react';\n\n` +
    `export function SignUp() {\n` +
    `  const { signUp } = useSignUp();\n` +
    `  const [emailAddress, setEmailAddress] = useState('');\n` +
    `  const [password, setPassword] = useState('');\n` +
    `  const [code, setCode] = useState('');\n` +
    `  const [verifying, setVerifying] = useState(false);\n\n` +
    `  const handleSignUp = async (e: FormEvent) => {\n` +
    `    e.preventDefault();\n` +
    `    const { error } = await signUp.password({ emailAddress, password });\n` +
    `    if (error) return;\n` +
    `    await signUp.verifications.sendEmailCode();\n` +
    `    setVerifying(true);\n` +
    `  };\n\n` +
    `  const handleVerify = async (e: FormEvent) => {\n` +
    `    e.preventDefault();\n` +
    `    await signUp.verifications.verifyEmailCode({ code });\n` +
    `    if (signUp.status === 'complete') await signUp.finalize({ navigate: () => {} });\n` +
    `  };\n\n` +
    `  if (verifying) {\n` +
    `    return (\n` +
    `      <form onSubmit={handleVerify}>\n` +
    `        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Verification code" />\n` +
    `        <button type="submit">Verify</button>\n` +
    `      </form>\n` +
    `    );\n` +
    `  }\n\n` +
    `  return (\n` +
    `    <form onSubmit={handleSignUp}>\n` +
    `      <h1>Sign up</h1>\n` +
    `      <input type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} placeholder="Email" />\n` +
    `      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />\n` +
    `      <button type="submit">Sign up</button>\n` +
    `    </form>\n` +
    `  );\n` +
    `}\n`;

  writeFileSync(join(authDir, 'sign-up.tsx'), source);
}

export interface IdentityProviders {
  email: 'password' | 'magic-link';
  google: boolean;
  github: boolean;
}

async function setupClerkAuth(targetDir: string, appName: string, providers: IdentityProviders): Promise<void> {
  const appDir = join(targetDir, 'apps', appName);
  await run('pnpm', ['add', '@clerk/react'], appDir);

  wireClerkProvider(appDir);

  const authDir = join(targetDir, 'libs', 'features', 'auth');
  mkdirSync(authDir, { recursive: true });
  writeSignInScreen(authDir, providers);
  writeSignUpScreen(authDir);

  writeEnvExample(targetDir, providers);
}

const identityProvidersSchema = z.object({
  email: z.enum(['password', 'magic-link']).default('password'),
  google: z.boolean().default(false),
  github: z.boolean().default(false),
});

const setupAuthInputSchema = z.object({
  targetDir: z.string().describe('Absolute path to a workspace already scaffolded by scaffold-workspace.'),
  appName: z.string().default('app').describe('The app slug generated by scaffold-workspace (default "app").'),
  authEngine: z
    .enum(['clerk', 'self-hosted'])
    .default('clerk')
    .describe('Auth engine. Default is Clerk (managed). Self-hosted (Better Auth) is v2, not built in this MVP.'),
  identityProviders: identityProvidersSchema.default({ email: 'password', google: false, github: false }),
});

export async function setupAuth(
  targetDir: string,
  appName: string,
  authEngine: 'clerk' | 'self-hosted',
  identityProviders: IdentityProviders,
): Promise<string> {
  writeUserSchema(targetDir);

  if (authEngine === 'self-hosted') {
    return (
      'Self-hosted auth (Better Auth) support is coming in v2 — the MVP wizard wires Clerk only. ' +
      'The user schema was still generated at libs/features/auth/user.schema.ts, since the first-party UI ' +
      'needs a shape to bind to regardless of engine. Re-run with authEngine: "clerk" to generate the auth screens now.'
    );
  }

  await setupClerkAuth(targetDir, appName, identityProviders);

  return `Generated Clerk-backed first-party sign-in/up screens at libs/features/auth (${identityProviders.email}${identityProviders.google ? ', Google' : ''}${identityProviders.github ? ', GitHub' : ''}), user schema, and .env.example.`;
}

export function registerSetupAuthTool(server: McpServer): void {
  server.registerTool(
    'setup-auth',
    {
      description:
        'Stage D (Authentication) of the forgekit-reactor wizard: generates first-party sign-in/up screens wired to Clerk\'s headless API (default engine), plus a user schema generated regardless of engine choice. Self-hosted engine (Better Auth) is v2, not built in this MVP — selecting it returns a clear message instead of partial auth code.',
      inputSchema: setupAuthInputSchema,
    },
    async ({ targetDir, appName, authEngine, identityProviders }) => {
      const message = await setupAuth(targetDir, appName, authEngine, identityProviders);
      return { content: [{ type: 'text', text: message }] };
    },
  );
}
