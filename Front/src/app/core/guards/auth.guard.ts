import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Si el access token está vencido pero hay refresh token, lo renueva acá antes
 * de activar la ruta — evita el round-trip evitable de navegar, pegarle a la
 * API, recibir 401 y recién ahí refrescar vía interceptor.
 */
function ensureValidSession(auth: AuthService, router: Router, loginPath: string): Observable<true | UrlTree> {
  if (!auth.isAuthenticated()) {
    return of(router.createUrlTree([loginPath]));
  }

  if (!auth.isTokenExpired()) {
    return of(true);
  }

  return auth.refreshToken().pipe(
    map(() => true as const),
    catchError(() => {
      auth.clearSession();
      return of(router.createUrlTree([loginPath]));
    }),
  );
}

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth   = inject(AuthService);
  return ensureValidSession(auth, router, '/login');
};

export const superAdminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const auth   = inject(AuthService);

  return ensureValidSession(auth, router, '/admin/login').pipe(
    map((result) => {
      if (result !== true) {
        return result;
      }
      const user = auth.getUser();
      return user?.isSuperAdmin ? true : router.createUrlTree(['/admin/login']);
    }),
  );
};
