import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut,
  type User 
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

interface UserData {
  email: string;
  displayName?: string;
  role?: string;
  permissions?: string[];
}

interface AuthContextType {
  currentUser: User | null;
  userData: UserData | null;
  loading: boolean;
  /** Lab role id from the `roleId` custom claim ('' when the account has no Lab role). */
  roleId: string;
  /** Permissions of that role (roles/{roleId}.permissions); 'admin' bypasses the list. */
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [roleId, setRoleId] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      
      if (user) {
        // Lab role: roleId custom claim -> roles/{roleId}.permissions (mirrors firestore.rules hasLabPermission)
        try {
          const token = await user.getIdTokenResult();
          const claimRole = typeof token.claims.roleId === 'string' ? token.claims.roleId : '';
          setRoleId(claimRole);
          if (claimRole && claimRole !== 'admin') {
            const roleDoc = await getDoc(doc(db, 'roles', claimRole));
            const perms = roleDoc.exists() ? roleDoc.data().permissions : [];
            setPermissions(Array.isArray(perms) ? perms.filter((p: unknown) => typeof p === 'string') : []);
          } else {
            setPermissions([]);
          }
        } catch (error) {
          console.error('Error resolving Lab role:', error);
          setRoleId('');
          setPermissions([]);
        }
        // Fetch user data from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            setUserData(userDoc.data() as UserData);
          } else {
            setUserData({
              email: user.email || '',
              displayName: user.displayName || undefined,
            });
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setUserData({
            email: user.email || '',
          });
        }
      } else {
        setUserData(null);
        setRoleId('');
        setPermissions([]);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const hasPermission = (permission: string) =>
    roleId === 'admin' || permissions.includes(permission);

  const value: AuthContextType = {
    currentUser,
    userData,
    loading,
    roleId,
    permissions,
    hasPermission,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
