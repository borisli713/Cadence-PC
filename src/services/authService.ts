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
import { translateStatic } from '../i18n/I18nContext';
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
      return translateStatic('auth_fb_invalid_email');
    case 'auth/user-disabled':
      return translateStatic('auth_fb_user_disabled');
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return translateStatic('auth_fb_invalid_credential');
    case 'auth/email-already-in-use':
      return translateStatic('auth_fb_email_in_use');
    case 'auth/weak-password':
      return translateStatic('auth_fb_weak_password');
    case 'auth/too-many-requests':
      return translateStatic('auth_fb_too_many_requests');
    case 'auth/popup-closed-by-user':
      return translateStatic('win_auth_popup_closed');
    case 'auth/popup-blocked':
      return translateStatic('win_auth_popup_blocked');
    case 'auth/network-request-failed':
      return translateStatic('auth_fb_network');
    default:
      return msg || translateStatic('win_auth_generic_fail');
  }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<User> {
  const cleanEmail = email.trim();
  if (!cleanEmail) throw new Error(translateStatic('auth_err_invalid_email'));
  if (!password) throw new Error(translateStatic('auth_err_enter_password'));
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
  if (!cleanName) throw new Error(translateStatic('auth_err_enter_full_name'));
  if (!cleanEmail) throw new Error(translateStatic('auth_err_invalid_email'));
  if (password.length < 6) {
    throw new Error(translateStatic('auth_err_password_min_6'));
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
  if (!cleanEmail) throw new Error(translateStatic('auth_err_enter_reset_email'));
  try {
    await sendPasswordResetEmail(auth, cleanEmail);
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

export async function resendVerificationEmail(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error(translateStatic('auth_err_no_user_session'));
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
