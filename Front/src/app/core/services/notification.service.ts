import { Injectable, inject } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import Swal from 'sweetalert2';

export interface ConfirmOptions {
  title?: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  /** Acciones irreversibles (eliminar, restablecer, etc.) — botón de confirmar en rojo. */
  danger?: boolean;
}

// Único punto de contacto con Toastr/SweetAlert2 en toda la app — ver
// CLAUDE.md §19. Nunca importar ToastrService/Swal directamente en un
// componente, siempre pasar por este servicio.
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly toastr = inject(ToastrService);

  success(message: string): void {
    this.toastr.success(message);
  }

  error(message: string): void {
    this.toastr.error(message);
  }

  warning(message: string): void {
    this.toastr.warning(message);
  }

  info(message: string): void {
    this.toastr.info(message);
  }

  async confirm(opts: ConfirmOptions): Promise<boolean> {
    const result = await Swal.fire({
      title: opts.title ?? '¿Estás seguro?',
      text: opts.text,
      icon: opts.danger ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: opts.confirmText ?? 'Confirmar',
      cancelButtonText: opts.cancelText ?? 'Cancelar',
      confirmButtonColor: opts.danger ? '#dc2626' : '#4f6ef7',
      cancelButtonColor: '#6b7280',
      reverseButtons: true,
      focusCancel: opts.danger,
    });
    return result.isConfirmed;
  }
}
