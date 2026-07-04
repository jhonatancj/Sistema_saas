# ADR-004: Refresh tokens con rotación y detección de reuse

## Contexto
Access tokens de vida corta requieren un mecanismo de refresh. Guardar
refresh tokens reutilizables indefinidamente es un riesgo si uno se filtra.

## Decisión
Cada `POST /auth/refresh` (tenant) y `POST /auth/admin/refresh` (super admin)
invalida el refresh token usado y emite uno nuevo perteneciente a la misma
`family` (UUID). Los tokens se guardan hasheados: `{schema}.refresh_tokens`
para tenant, `public.super_admin_refresh_tokens` para super admin — tablas
separadas, mismo patrón de rotación en ambas.

## Consecuencias
- Si un refresh token robado se usa después de que el legítimo ya rotó, se
  puede detectar (mismo `family`, hash distinto al esperado) y revocar toda la
  familia — no implementado como reacción automática todavía, pero el
  `family` ya está disponible para esa lógica futura.
- El frontend implementa single-flight refresh (`auth.interceptor.ts`): si
  varias requests concurrentes reciben 401, solo se dispara un
  `POST /auth/refresh`, las demás esperan ese resultado y reintentan — evita
  una carrera donde dos refresh simultáneos invalidarían el token del otro.
