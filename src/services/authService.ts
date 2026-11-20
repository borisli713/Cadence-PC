import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';
import {
  invokeCancelExternalGoogleLogin,
  invokeStartExternalGoogleLogin,
  isTauriDesktop,
} from '../utils/tauriBridge';

export function mapAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');

  switch (code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'An account already exists for that email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/popup-blocked':
      return 'Popup was blocked. Please allow popups or sign in with email & password.';
    case 'auth/network-request-failed':
      return 'Network error while connecting to authentication service.';
    default:
      return msg || 'Authentication failed. Please try again.';
  }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<User> {
  const cleanEmail = email.trim();
  if (!cleanEmail) throw new Error('Enter your email address.');
  if (!password) throw new Error('Enter your password.');
  try {
    const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
    return cred.user;
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function signUpWithEmail(
  fullName: string,
  email: string,
  password: string,
): Promise<{ user: User; sentVerification: boolean }> {
  const cleanName = fullName.trim();
  const cleanEmail = email.trim();
  if (!cleanName) throw new Error('Enter your full name.');
  if (!cleanEmail) throw new Error('Enter your email address.');
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  try {
    const cred = await createUserWithEmailAndPassword(
      auth,
      cleanEmail,
      password,
    );
    await updateProfile(cred.user, { displayName: cleanName.slice(0, 80) });
    let sentVerification = false;
    try {
      await sendEmailVerification(cred.user);
      sentVerification = true;
    } catch {
      sentVerification = false;
    }
    return { user: cred.user, sentVerification };
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function signInWithGoogleDesktopExternal(): Promise<User> {
  try {
    const oauthResult = await invokeStartExternalGoogleLogin();
    const credential = GoogleAuthProvider.credential(
      oauthResult.idToken,
      oauthResult.accessToken ?? undefined,
    );
    const cred = await signInWithCredential(auth, credential);
    return cred.user;
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function cancelExternalGoogleLogin(): Promise<void> {
  await invokeCancelExternalGoogleLogin();
}

export async function signInWithGoogle(): Promise<User> {
  if (isTauriDesktop()) {
    return signInWithGoogleDesktopExternal();
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  const cleanEmail = email.trim();
  if (!cleanEmail) throw new Error('Enter your email address first.');
  try {
    await sendPasswordResetEmail(auth, cleanEmail);
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function resendVerificationEmail(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('No active user session found.');
  try {
    await sendEmailVerification(user);
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function reloadAndCheckVerified(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    await user.reload();
    await user.getIdToken(true);
    return Boolean(auth.currentUser?.emailVerified);
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}
