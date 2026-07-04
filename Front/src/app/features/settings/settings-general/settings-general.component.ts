import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { ApiService } from '../../../core/services/api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { NotificationService } from '../../../core/services/notification.service';

interface ApiResp<T> { success: boolean; data: T; message: string; errors: string[]; }

interface TenantSettings {
  name: string;
  trade_name?: string;
  tax_id?: string;
  country_code?: string;
  timezone?: string;
  locale?: string;
  contact_email?: string;
  contact_phone?: string;
  logo_url?: string;
}

@Component({
  selector: 'app-settings-general',
  standalone: true,
  imports: [ReactiveFormsModule, NgSelectModule],
  templateUrl: './settings-general.component.html',
  styleUrl: './settings-general.component.scss',
})
export class SettingsGeneralComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly notification = inject(NotificationService);

  readonly loading = signal(false);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    name: ['', Validators.required],
    trade_name: [''],
    tax_id: [''],
    country_code: [''],
    timezone: [''],
    locale: [''],
    contact_email: ['', Validators.email],
    contact_phone: [''],
    logo_url: [''],
  });

  readonly COUNTRIES = [
    { code: 'AR', label: 'Argentina' },
    { code: 'BO', label: 'Bolivia' },
    { code: 'BR', label: 'Brasil' },
    { code: 'CL', label: 'Chile' },
    { code: 'CO', label: 'Colombia' },
    { code: 'CR', label: 'Costa Rica' },
    { code: 'CU', label: 'Cuba' },
    { code: 'DO', label: 'República Dominicana' },
    { code: 'EC', label: 'Ecuador' },
    { code: 'SV', label: 'El Salvador' },
    { code: 'GT', label: 'Guatemala' },
    { code: 'HN', label: 'Honduras' },
    { code: 'MX', label: 'México' },
    { code: 'NI', label: 'Nicaragua' },
    { code: 'PA', label: 'Panamá' },
    { code: 'PY', label: 'Paraguay' },
    { code: 'PE', label: 'Perú' },
    { code: 'ES', label: 'España' },
    { code: 'UY', label: 'Uruguay' },
    { code: 'VE', label: 'Venezuela' },
    { code: 'US', label: 'Estados Unidos' },
    { code: 'CA', label: 'Canadá' },
    { code: 'GB', label: 'Reino Unido' },
    { code: 'DE', label: 'Alemania' },
    { code: 'FR', label: 'Francia' },
    { code: 'IT', label: 'Italia' },
    { code: 'PT', label: 'Portugal' },
  ];

  readonly TIMEZONES = [
    { value: 'America/Bogota',                   label: 'Bogotá (UTC-5)' },
    { value: 'America/Lima',                      label: 'Lima (UTC-5)' },
    { value: 'America/Guayaquil',                 label: 'Quito / Guayaquil (UTC-5)' },
    { value: 'America/Panama',                    label: 'Panamá (UTC-5)' },
    { value: 'America/Havana',                    label: 'La Habana (UTC-5/-4)' },
    { value: 'America/New_York',                  label: 'Nueva York (UTC-5/-4)' },
    { value: 'America/Toronto',                   label: 'Toronto (UTC-5/-4)' },
    { value: 'America/Santo_Domingo',             label: 'Santo Domingo (UTC-4)' },
    { value: 'America/Caracas',                   label: 'Caracas (UTC-4)' },
    { value: 'America/La_Paz',                    label: 'La Paz (UTC-4)' },
    { value: 'America/Asuncion',                  label: 'Asunción (UTC-4/-3)' },
    { value: 'America/Santiago',                  label: 'Santiago (UTC-4/-3)' },
    { value: 'America/Chicago',                   label: 'Chicago (UTC-6/-5)' },
    { value: 'America/Mexico_City',               label: 'Ciudad de México (UTC-6/-5)' },
    { value: 'America/Guatemala',                 label: 'Guatemala (UTC-6)' },
    { value: 'America/Managua',                   label: 'Managua (UTC-6)' },
    { value: 'America/Tegucigalpa',               label: 'Tegucigalpa (UTC-6)' },
    { value: 'America/El_Salvador',               label: 'San Salvador (UTC-6)' },
    { value: 'America/Costa_Rica',                label: 'San José (UTC-6)' },
    { value: 'America/Denver',                    label: 'Denver (UTC-7/-6)' },
    { value: 'America/Los_Angeles',               label: 'Los Ángeles (UTC-8/-7)' },
    { value: 'America/Vancouver',                 label: 'Vancouver (UTC-8/-7)' },
    { value: 'America/Argentina/Buenos_Aires',    label: 'Buenos Aires (UTC-3)' },
    { value: 'America/Sao_Paulo',                 label: 'São Paulo (UTC-3/-2)' },
    { value: 'America/Montevideo',                label: 'Montevideo (UTC-3)' },
    { value: 'Europe/Madrid',                     label: 'Madrid (UTC+1/+2)' },
    { value: 'Europe/Lisbon',                     label: 'Lisboa (UTC+0/+1)' },
    { value: 'Europe/London',                     label: 'Londres (UTC+0/+1)' },
    { value: 'Europe/Paris',                      label: 'París (UTC+1/+2)' },
    { value: 'Europe/Berlin',                     label: 'Berlín (UTC+1/+2)' },
    { value: 'Europe/Rome',                       label: 'Roma (UTC+1/+2)' },
    { value: 'UTC',                               label: 'UTC (UTC+0)' },
  ];

  readonly LOCALES = [
    { value: 'es-CO', label: 'Español (Colombia)' },
    { value: 'es-MX', label: 'Español (México)' },
    { value: 'es-AR', label: 'Español (Argentina)' },
    { value: 'es-CL', label: 'Español (Chile)' },
    { value: 'es-PE', label: 'Español (Perú)' },
    { value: 'es-VE', label: 'Español (Venezuela)' },
    { value: 'es-ES', label: 'Español (España)' },
    { value: 'es-EC', label: 'Español (Ecuador)' },
    { value: 'es-BO', label: 'Español (Bolivia)' },
    { value: 'es-PY', label: 'Español (Paraguay)' },
    { value: 'es-UY', label: 'Español (Uruguay)' },
    { value: 'es-CR', label: 'Español (Costa Rica)' },
    { value: 'es-GT', label: 'Español (Guatemala)' },
    { value: 'es-HN', label: 'Español (Honduras)' },
    { value: 'es-PA', label: 'Español (Panamá)' },
    { value: 'es-SV', label: 'Español (El Salvador)' },
    { value: 'es-NI', label: 'Español (Nicaragua)' },
    { value: 'es-DO', label: 'Español (Rep. Dominicana)' },
    { value: 'es-CU', label: 'Español (Cuba)' },
    { value: 'en-US', label: 'English (United States)' },
    { value: 'en-GB', label: 'English (United Kingdom)' },
    { value: 'en-CA', label: 'English (Canada)' },
    { value: 'pt-BR', label: 'Português (Brasil)' },
    { value: 'pt-PT', label: 'Português (Portugal)' },
    { value: 'fr-FR', label: 'Français (France)' },
    { value: 'de-DE', label: 'Deutsch (Deutschland)' },
    { value: 'it-IT', label: 'Italiano (Italia)' },
  ];

  ngOnInit(): void {
    this.breadcrumbs.set([
      { label: 'Configuración' },
      { label: 'General' },
    ]);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.get<ApiResp<TenantSettings>>('/tenants/settings').subscribe({
      next: (res) => {
        this.form.patchValue(res.data ?? {});
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('Error al cargar la configuración');
      },
    });
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.api.patch<ApiResp<TenantSettings>>('/tenants/settings', this.form.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.notification.success('Cambios guardados correctamente');
      },
      error: (err) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'Error al guardar');
      },
    });
  }
}
