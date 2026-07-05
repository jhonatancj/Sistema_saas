import { Injectable } from '@angular/core';
import { FormOptionsProvider } from '@jhonatancj/dforms';

// Catálogos de prueba para validar el flujo de selects dependientes
// (optionsSource + optionsParams) desde el builder antes de tener un
// endpoint real en el backend. Reemplazar por un servicio que pegue a la API
// del tenant (ver README de dforms, sección FORM_OPTIONS_PROVIDER) cuando se
// defina qué catálogos necesita cada select.
const MOCK_COUNTRIES = [
  { id: 1, codigo: 'CO', nombre: 'Colombia' },
  { id: 2, codigo: 'MX', nombre: 'México' },
  { id: 3, codigo: 'AR', nombre: 'Argentina' },
  { id: 4, codigo: 'PE', nombre: 'Perú' },
];

const MOCK_DEPARTMENTS: Record<string, { id: number; nombre: string }[]> = {
  CO: [
    { id: 101, nombre: 'Bogotá D.C.' },
    { id: 102, nombre: 'Antioquia' },
    { id: 103, nombre: 'Valle del Cauca' },
  ],
  MX: [
    { id: 201, nombre: 'Ciudad de México' },
    { id: 202, nombre: 'Jalisco' },
  ],
  AR: [
    { id: 301, nombre: 'Buenos Aires' },
    { id: 302, nombre: 'Córdoba' },
  ],
  PE: [
    { id: 401, nombre: 'Lima' },
    { id: 402, nombre: 'Cusco' },
  ],
};

const MOCK_DELAY_MS = 300;

@Injectable({ providedIn: 'root' })
export class FormOptionsMockService implements FormOptionsProvider {
  async loadOptions(endpointId: string, params?: Record<string, any>): Promise<any[]> {
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

    switch (endpointId) {
      case 'GET_COUNTRIES':
        return MOCK_COUNTRIES;

      case 'GET_DEPARTMENTS': {
        const country = params?.['country'] ?? params?.['countryCode'];
        return MOCK_DEPARTMENTS[country] ?? [];
      }

      default:
        console.warn(`[FormOptionsMockService] endpoint desconocido: ${endpointId}`);
        return [];
    }
  }
}