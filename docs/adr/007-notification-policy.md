# ADR-007: Política única de notificaciones y diálogos

## Contexto
Antes de esta decisión, cada componente reimplementaba su propio patrón de
mensajes (`successMsg`/`errorMsg` + `flash()` + `setTimeout` + div), sin
consistencia entre componentes ni una regla clara de cuándo usar un modal vs.
un mensaje que desaparece solo.

## Decisión
Un único `NotificationService` (`Front/src/app/core/services/notification.service.ts`)
es el **único** punto de entrada a Toastr/SweetAlert2 — ningún componente los
llama directo.

| Caso | Mecanismo |
|---|---|
| Operación completada sin decisión del usuario (creado/editado/eliminado, error de servidor) | Toastr — corto, sin botones, se cierra solo |
| El usuario debe confirmar/decidir, especialmente acciones irreversibles | SweetAlert2 — siempre 2 botones, estilo `danger` en destructivas |
| Error de validación de campo (obligatorio, formato, longitud) | Inline junto al campo — nunca Toastr, nunca modal |

Regla dura: **nunca** un modal para un mensaje de éxito simple; **nunca**
eliminar/restaurar/sobrescribir/reiniciar sin pasar por `notification.confirm()`
antes.

## Consecuencias
- `provideAnimations()` (requerido "normalmente" por `ngx-toastr`) rompe el
  bootstrap de Angular 22 (`NG0201`) — usar `provideAnimationsAsync()`.
- Cualquier componente nuevo con un mensaje de estado debe pasar por este
  servicio; agregar un mecanismo de notificación ad-hoc en un componente
  nuevo es una violación directa de esta política (ver "Anti-patrones
  prohibidos" en `CLAUDE.md`).
