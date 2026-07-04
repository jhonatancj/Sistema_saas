import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

// Rutas de auth que nunca deben disparar un refresh (evita loops infinitos)
const AUTH_FREE_PATHS = ['/auth/login', '/auth/admin/login', '/auth/refresh', '/auth/admin/refresh'];

// Estado compartido entre requests concurrentes (single-flight refresh)
let isRefreshing = false;
const refreshedToken$ = new BehaviorSubject<string | null>(null);

function withToken(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isAuthFreeRequest = AUTH_FREE_PATHS.some((path) => req.url.includes(path));

  return next(req).pipe(
    catchError((error: unknown) => {
      const is401 = error instanceof HttpErrorResponse && error.status === 401;
      if (!is401 || isAuthFreeRequest) {
        return throwError(() => error);
      }

      if (!isRefreshing) {
        isRefreshing = true;
        refreshedToken$.next(null);

        return auth.refreshToken().pipe(
          switchMap((res) => {
            isRefreshing = false;
            const newToken = res.data.accessToken;
            refreshedToken$.next(newToken);
            return next(withToken(req, newToken));
          }),
          catchError((refreshError) => {
            isRefreshing = false;
            auth.forceLogout();
            return throwError(() => refreshError);
          }),
        );
      }

      // Ya hay un refresh en curso: esperar su resultado y reintentar con el token nuevo
      return refreshedToken$.pipe(
        filter((token): token is string => token !== null),
        take(1),
        switchMap((token) => next(withToken(req, token))),
      );
    }),
  );
};
