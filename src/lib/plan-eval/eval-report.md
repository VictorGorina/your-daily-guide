# Eval de exactitud — 2026-09-24 17:39 UTC

## Tabla de composición frente a referencias externas (17)

Casado a la fila correcta: 64.7 % · filas que faltan: 5 · kcal/100 g, error medio: 25.3 % · proteína: 47.6 % · grasa: 37.7 %

_Si no casa con ninguna fila, se mide el genérico de 130 kcal que sumaría producción._

| Nombre                        | Fila que suma hoy                         | kcal  | Proteína | Grasa  |
| ----------------------------- | ----------------------------------------- | ----- | -------- | ------ |
| fuet                          | ⚠ genérico (debería ser salchichon)       | -70 % | -78 %    | -86 %  |
| bacon                         | ⚠ genérico (falta fila `bacon`)           | -55 % | -60 %    | -80 %  |
| salmorejo                     | salmorejo                                 | +47 % | +18 %    | +41 %  |
| morcilla                      | morcilla                                  | +46 % | +86 %    | +111 % |
| tortilla de patatas           | ⚠ patata (falta fila `tortilla-patatas`)  | -44 % | -62 %    | -99 %  |
| pizza margarita               | ⚠ genérico (falta fila `pizza`)           | -40 % | -32 %    | -17 %  |
| hummus                        | hummus                                    | -36 % | +19 %    | -55 %  |
| bebida de soja                | ⚠ bebida-avena (falta fila `bebida-soja`) | +32 % | -46 %    | -4 %   |
| pechuga de pavo loncheada     | jamon-cocido                              | +25 % | +13 %    | +50 %  |
| croquetas de jamón            | ⚠ jamon-serrano (falta fila `croqueta`)   | +24 % | +370 %   | +46 %  |
| pan de pita                   | pan-blanco                                | +8 %  | +7 %     | +42 %  |
| vino tinto                    | vino-cocinar                              | -2 %  | +1 %     | +0 %   |
| salmón a la plancha           | salmon                                    | +1 %  | -10 %    | +5 %   |
| cerveza                       | cerveza                                   | +0 %  | +1 %     | +0 %   |
| pechuga de pollo a la plancha | pechuga-pollo                             | +0 %  | +0 %     | +1 %   |
| bacalao al horno              | bacalao                                   | +0 %  | +1 %     | +3 %   |
| arroz blanco cocido           | arroz-blanco                              | +0 %  | +6 %     | +2 %   |

## Descomposición frente a recetas de referencia

Modelo: `openai/gpt-5` · 75 platos (0 revisados a mano) · 3 pasada(s) por plato

### Resumen

| Métrica                                        | Medido  | Objetivo |     |
| ---------------------------------------------- | ------- | -------- | --- |
| kcal por ración, error medio                   | 23.2%   | ≤ 6%     | ✗   |
| kcal por ración, P90                           | 44.5%   | ≤ 12%    | ✗   |
| kcal por 100 g, error medio                    | 5.2%    | ≤ 6%     | ✓   |
| reparto de macros                              | 5.3 pts | ≤ 3 pts  | ✗   |
| proteína por ración, error medio               | 23.3%   | ≤ 8%     | ✗   |
| ingredientes principales omitidos              | 9.2%    | ≤ 1%     | ✗   |
| mismo plato → mismas cifras (CV entre pasadas) | 3.9%    | ≤ 0%     | ✗   |

Sesgo de kcal (con signo): +21.5 % · carbohidratos: 26.4 % · grasa: 23.1 % · aceite: ±2 g · inventados por plato: 0.3 · pasadas sin descomponer (fuera de las métricas): 24/225
Latencia: 591.4 s por pasada completa (lotes de 8).

### Los 15 platos con más error de kcal

| Plato                                               | Ref. | Salida | Error | CV   | Motivo                                                                                      |
| --------------------------------------------------- | ---- | ------ | ----- | ---- | ------------------------------------------------------------------------------------------- |
| Crema de calabacín con picatostes de pan integral · | 188  | 309    | +65 % | 4 %  | inventa patata, caldo                                                                       |
| Tostada integral con tomate y huevo revuelto ·      | 229  | 376    | +64 % | 3 %  | aceite +5 g · pan-integral +20 % en gramos                                                  |
| Yogur natural con plátano ·                         | 130  | 210    | +62 % | 0 %  | error repartido, sin una causa dominante                                                    |
| Muslos de pollo al horno con patatas y cebolla ·    | 444  | 705    | +59 % | 5 %  | muslo-pollo +117 % en gramos                                                                |
| Garbanzos guisados con verduras ·                   | 349  | 553    | +59 % | 9 %  | omite caldo · inventa patata · garbanzos +35 % en gramos                                    |
| Tostada integral con huevo revuelto ·               | 222  | 350    | +58 % | 6 %  | pan-integral +20 % en gramos                                                                |
| Lentejas guisadas con arroz integral ·              | 346  | 510    | +47 % | 11 % | omite caldo                                                                                 |
| Tapas: patatas bravas y croquetas ·                 | 607  | 878    | +44 % | 7 %  | omite patata-frita · inventa patata, mayonesa · aceite +13 g · patata-frita +20 % en gramos |
| Crema de calabacín y zanahoria ·                    | 126  | 182    | +44 % | 22 % | inventa caldo                                                                               |
| Pechuga de pollo a la plancha con ensalada ·        | 254  | 365    | +43 % | 17 % | aceite +5 g · pechuga-pollo +45 % en gramos                                                 |
| Tostada integral con tomate y aceite ·              | 175  | 250    | +43 % | 1 %  | aceite +5 g · pan-integral +20 % en gramos                                                  |
| Bocadillo de tortilla ·                             | 492  | 698    | +42 % | 20 % | omite patata · aceite +10 g                                                                 |
| Tortilla de patatas y cebolla ·                     | 398  | 555    | +39 % | 2 %  | aceite +11 g · patata +24 % en gramos                                                       |
| Tostada integral con aguacate y huevo ·             | 275  | 382    | +39 % | 2 %  | inventa aceite · aceite +5 g · pan-integral +20 % en gramos                                 |
| Tostada integral con aguacate y tomate ·            | 211  | 287    | +36 % | 8 %  | inventa aceite · pan-integral +20 % en gramos                                               |

_· = receta de referencia aún sin revisar a mano._

#### Dónde están las kcal (1.ª pasada; gramos ref. → salida, kcal de diferencia)

- **Crema de calabacín con picatostes de pan integral**: patata 0→60 g (+52) · pan-integral 20→30 g (+25) · caldo 0→250 g (+15) · calabacin 170→250 g (+14) · aceite 11→10 g (-9) · cebolla 30→50 g (+8)
- **Tostada integral con tomate y huevo revuelto**: huevo 50→100 g (+72) · aceite 3→7 g (+35) · pan-integral 50→60 g (+25) · tomate 40→70 g (+5)
- **Yogur natural con plátano**: platano 60→150 g (+80)
- **Muslos de pollo al horno con patatas y cebolla**: muslo-pollo 86→172 g (+180) · patata 175→200 g (+22) · aceite 10→12 g (+18) · cebolla 60→80 g (+8)
- **Garbanzos guisados con verduras**: garbanzos 133→180 g (+77) · tomate-triturado 0→100 g (+32) · aceite 8→10 g (+18) · zanahoria 40→80 g (+16) · calabacin 0→80 g (+14) · caldo 150→0 g (-9)
- **Tostada integral con huevo revuelto**: huevo 50→100 g (+72) · pan-integral 50→60 g (+25) · aceite 3→5 g (+18)
- **Lentejas guisadas con arroz integral**: arroz-integral 66→120 g (+60) · tomate-triturado 0→80 g (+26) · zanahoria 30→60 g (+12) · caldo 150→0 g (-9) · aceite 7→8 g (+9) · cebolla 20→40 g (+8)
- **Tapas: patatas bravas y croquetas**: aceite 15→25 g (+88) · patata-frita 150→180 g (+57) · tomate-frito 20→50 g (+25) · pan-rallado 8→12 g (+14) · jamon-serrano 8→12 g (+10) · huevo 6→12 g (+9)
- **Crema de calabacín y zanahoria**: aceite 8→10 g (+18) · zanahoria 60→100 g (+16) · calabacin 110→200 g (+15) · cebolla 30→60 g (+12) · caldo 0→200 g (+12)
- **Pechuga de pollo a la plancha con ensalada**: aceite 10→20 g (+88) · pechuga-pollo 83→130 g (+78) · pepino 0→40 g (+6)
- **Tostada integral con tomate y aceite**: aceite 5→10 g (+44) · pan-integral 50→60 g (+25) · tomate 40→80 g (+7)
- **Bocadillo de tortilla**: aceite 8→25 g (+150) · huevo 51→110 g (+84) · patata 86→150 g (+56)
- **Tortilla de patatas y cebolla**: aceite 14→25 g (+97) · patata 150→200 g (+44) · huevo 90→100 g (+14) · cebolla 38→60 g (+9)
- **Tostada integral con aguacate y huevo**: aceite 0→5 g (+44) · aguacate 50→70 g (+32) · pan-integral 50→60 g (+25) · huevo 50→60 g (+14)
- **Tostada integral con aguacate y tomate**: aguacate 50→70 g (+32) · pan-integral 50→60 g (+25)
