# Guion del video pitch (≈ 3 min)

El University Track pide explicar **el problema, la solución, cómo funciona y cómo usa Stellar**. Este guion cubre los cuatro en ese orden. Tiempos aproximados; graba la pantalla con la app en producción (mainnet), o en testnet si aún no despliegas.

| Tiempo | Imagen | Voz |
| --- | --- | --- |
| 0:00–0:20 | Foto/video de escombro tirado en un baldío o arroyo. | "Cada demolición deja toneladas de escombro. En casi todo México no está regulado: termina en baldíos y arroyos. Quien lo mueve suele cobrar en efectivo, tarde o nunca." |
| 0:20–0:40 | Bloque físico (o render) + foto del ensayo de laboratorio. | "Escomblock nació como investigación estudiantil: un bloque de mampostería hecho con escombro que aguanta el calor y la humedad de Sinaloa. Pero un bloque reciclado necesita algo más: confianza." |
| 0:40–1:00 | Pantalla Inicio de la app (KPIs + 4 pasos). | "Escomblock es una plataforma en Stellar que convierte escombro en bloques certificados, paga al instante a quien lo recolecta y prueba el impacto sin doble conteo." |
| 1:00–1:25 | Planta → Boleta de báscula → "Registrar y pagar". Mostrar el toast con la tx. | "Paso 1: la planta pesa la entrega. El contrato Soroban paga al recolector en USDC en la misma transacción: 4 dólares por tonelada, en segundos, con comisión de fracciones de centavo." |
| 1:25–1:40 | Crear lote seleccionando entregas. | "Paso 2: las entregas forman un lote. Cada kilo queda ligado a su origen y ninguna entrega se puede usar dos veces." |
| 1:40–2:05 | Laboratorio → medidores → subir PDF → Certificar. | "Paso 3: un laboratorio independiente sube resistencia, absorción y ciclos de calor-humedad, más la huella SHA-256 del informe. Si cumple, el contrato emite créditos ESCB: un ESCB por kilo de escombro desviado. La planta no puede certificarse a sí misma." |
| 2:05–2:30 | Mercado → comprar → enviar → confirmar → retirar. | "Paso 4: la constructora compra con USDC en garantía. Al confirmar la entrega, la planta cobra y los ESCB de esos bloques pasan a la constructora, que los retira para reclamar su impacto. Retirar quema el crédito: nadie lo cuenta dos veces." |
| 2:30–2:45 | Pasaporte con QR; escanearlo con el celular. | "Cada bloque lleva un QR con su pasaporte: ensayo, origen del escombro y a quién se le pagó." |
| 2:45–3:00 | Diagrama de arquitectura / Stellar Expert. | "¿Por qué Stellar? Pagos de centavos que sí llegan, ESCB como activo real vía Stellar Asset Contract, y reglas en Soroban con 28 pruebas más pruebas de punta a punta en una red Stellar real. Escomblock: el escombro de ayer es el bloque de mañana." |

## Consejos de grabación

- Prepara las cuentas antes de grabar: planta y laboratorio registrados, USDC y ESCB activados, saldo USDC en la planta y en la constructora.
- Graba a 1280×800 o mayor; acerca el zoom del navegador al 110 % para que se lea bien.
- Abre al menos una transacción en Stellar Expert desde el aviso de la app: demuestra que es real.
- Subtítulos en español e inglés amplían el público del jurado del General Track.

## Versión corta en inglés (General Track, 60 s)

"Construction rubble is mostly unregulated in Mexico and ends up dumped. Escomblock started as a student research project on a masonry block made from rubble that survives Sinaloa's heat and humidity. On Stellar, we make it a circular economy: plants weigh each delivery and a Soroban contract pays the collector in USDC in the same transaction. Deliveries become batches; an independent lab uploads strength, absorption and heat-cycle results plus the report hash, and only passing batches mint ESCB, a Stellar asset where one credit equals one kilo of rubble diverted. Builders buy blocks with USDC in escrow, receive the credits on delivery and retire them, burning them so impact is never double-counted. Every block carries a QR passport. Fast, cheap payments, real assets via SAC, and rules enforced on-chain: that's why Stellar."
