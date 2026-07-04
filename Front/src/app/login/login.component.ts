import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { TenantService } from '../core/services/tenant.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);

  email = '';
  password = '';
  loading = signal(false);
  error = signal('');

  login() {
    this.loading.set(true);
    this.error.set('');

    const isAdmin = this.tenant.isAdminContext();

    const request$ = isAdmin ? this.auth.loginSuperAdmin(this.email, this.password) : this.auth.login(this.email, this.password);
    request$.subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate([isAdmin ? '/admin/dashboard' : '/dashboard']);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.message ?? 'Error al iniciar sesión');
      },
    });
  }
}
