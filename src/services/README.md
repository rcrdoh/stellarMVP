# services

Casos de uso. Orquestan dominio e integraciones sin acoplarse al transporte HTTP.

Los servicios dependen de interfaces, no de adaptadores concretos. Eso mantiene la regla de inversion de dependencias y permite reemplazar memoria por DB, cola o API externa sin tocar el caso de uso.
