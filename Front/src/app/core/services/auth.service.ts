import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { TenantService } from './tenant.service';
import { Observable, tap } from 'rxjs';

interface SessionUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
    isSuperAdmin?: boolean;
}

interface LoginResponse {
    success: boolean;
    data: {
        accessToken: string;
        refreshToken: string;
        user: SessionUser;
    };
}

interface RefreshResponse {
    success: boolean;
    data: {
        accessToken: string;
        refreshToken: string;
    };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly api = inject(ApiService);
    private readonly router = inject(Router);
    private readonly tenant = inject(TenantService);

    login(email: string, password: string) {
        const tenantSlug = this.tenant.current().slug;
        return this.api.post<LoginResponse>('/auth/login', { tenantSlug, email, password }).pipe(
            tap((res) => {
                if (res.success) {
                    this.storeSession(res.data.accessToken, res.data.refreshToken, res.data.user, false);
                }
            }),
        );
    }

    loginSuperAdmin(email: string, password: string) {
        return this.api.post<LoginResponse>('/auth/admin/login', { email, password }).pipe(
            tap((res) => {
                if (res.success) {
                    this.storeSession(res.data.accessToken, res.data.refreshToken, res.data.user, true);
                }
            }),
        );
    }

    /** Renueva el accessToken usando el refreshToken guardado. Usado por el interceptor HTTP en 401. */
    refreshToken(): Observable<RefreshResponse> {
        const refreshToken = localStorage.getItem('refresh_token');
        const isSuperAdmin = this.isSuperAdminSession();
        const path = isSuperAdmin ? '/auth/admin/refresh' : '/auth/refresh';
        const body = isSuperAdmin
            ? { refreshToken }
            : { tenantSlug: this.tenant.current().slug, refreshToken };

        return this.api.post<RefreshResponse>(path, body).pipe(
            tap((res) => {
                if (res.success) {
                    localStorage.setItem('access_token', res.data.accessToken);
                    localStorage.setItem('refresh_token', res.data.refreshToken);
                }
            }),
        );
    }

    logout() {
        const refreshToken = localStorage.getItem('refresh_token');
        const isSuperAdmin = this.isSuperAdminSession();
        const path = isSuperAdmin ? '/auth/admin/logout' : '/auth/logout';
        const body = isSuperAdmin
            ? { refreshToken }
            : { tenantSlug: this.tenant.current().slug, refreshToken };

        if (refreshToken) {
            this.api.post(path, body).subscribe();
        }
        this.clearSessionAndRedirect(isSuperAdmin);
    }

    /** Cierra la sesión localmente sin llamar al backend. Usado cuando el refresh automático falla. */
    forceLogout() {
        const isSuperAdmin = this.isSuperAdminSession();
        this.clearSessionAndRedirect(isSuperAdmin);
    }

    isAuthenticated(): boolean {
        return !!localStorage.getItem('access_token');
    }

    /** Decodifica el exp del JWT localmente para evitar el round-trip de un 401 evitable. */
    isTokenExpired(bufferSeconds = 10): boolean {
        const token = localStorage.getItem('access_token');
        if (!token) {
            return true;
        }
        const payload = this.decodeToken(token);
        if (!payload?.exp) {
            return true;
        }
        return Date.now() >= (payload.exp - bufferSeconds) * 1000;
    }

    getUser() {
        const user = localStorage.getItem('user');
        const isSuperAdmin = this.isSuperAdminSession();

        return user ? { ...JSON.parse(user), isSuperAdmin } : null;
    }

    /** Limpia la sesión sin navegar. Usado por los guards cuando un refresh proactivo falla. */
    clearSession() {
        localStorage.clear();
    }

    private isSuperAdminSession(): boolean {
        return JSON.parse(localStorage.getItem('isSuperAdmin') ?? 'false');
    }

    private decodeToken(token: string): { exp?: number } | null {
        try {
            const payload = token.split('.')[1];
            const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
            return JSON.parse(atob(base64));
        } catch {
            return null;
        }
    }

    private storeSession(accessToken: string, refreshToken: string, user: SessionUser, isSuperAdmin: boolean) {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('isSuperAdmin', JSON.stringify(isSuperAdmin || (user.isSuperAdmin ?? false)));
    }

    private clearSessionAndRedirect(isSuperAdmin: boolean) {
        this.clearSession();
        this.router.navigate([isSuperAdmin ? '/admin/login' : '/login']);
    }
}