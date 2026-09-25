# Eval de exactitud — 2026-09-25 11:47 UTC

## Tabla de composición frente a referencias externas (17)

Casado a la fila correcta: 100 % · filas que faltan: 0 · kcal/100 g, error medio: 8.7 % · proteína: 9.2 % · grasa: 15.5 %

_Si no casa con ninguna fila, se mide el genérico de 130 kcal que sumaría producción._

| Nombre                        | Fila que suma hoy      | kcal  | Proteína | Grasa  |
| ----------------------------- | ---------------------- | ----- | -------- | ------ |
| salmorejo                     | salmorejo              | +47 % | +18 %    | +41 %  |
| morcilla                      | morcilla               | +46 % | +86 %    | +111 % |
| hummus                        | hummus                 | -36 % | +19 %    | -55 %  |
| pan de pita                   | pan-blanco             | +8 %  | +7 %     | +42 %  |
| fuet                          | salchichon             | -4 %  | -4 %     | -3 %   |
| vino tinto                    | vino-cocinar           | -2 %  | +1 %     | +0 %   |
| croquetas de jamón            | croqueta               | +2 %  | +3 %     | +2 %   |
| salmón a la plancha           | salmon                 | +1 %  | -10 %    | +5 %   |
| tortilla de patatas           | tortilla-patatas       | +1 %  | +0 %     | +0 %   |
| pizza margarita               | pizza                  | +0 %  | +0 %     | +0 %   |
| cerveza                       | cerveza                | +0 %  | +1 %     | +0 %   |
| pechuga de pollo a la plancha | pechuga-pollo          | +0 %  | +0 %     | +1 %   |
| bacalao al horno              | bacalao                | +0 %  | +1 %     | +3 %   |
| arroz blanco cocido           | arroz-blanco           | +0 %  | +6 %     | +2 %   |
| pechuga de pavo loncheada     | pechuga-pavo-loncheada | +0 %  | +0 %     | +0 %   |
| bacon                         | bacon                  | +0 %  | +0 %     | +0 %   |
| bebida de soja                | bebida-soja            | +0 %  | +0 %     | +0 %   |

## Descomposición frente a recetas de referencia

Modelo: `openai/gpt-5` · 75 platos (0 revisados a mano) · 3 pasada(s) por plato

### Resumen

| Métrica                                        | Medido  | Objetivo |     |
| ---------------------------------------------- | ------- | -------- | --- |
| kcal por ración, error medio                   | 10.8%   | ≤ 6%     | ✗   |
| kcal por ración, P90                           | 25%     | ≤ 12%    | ✗   |
| kcal por 100 g, error medio                    | 12.6%   | ≤ 6%     | ✗   |
| reparto de macros                              | 4.7 pts | ≤ 3 pts  | ✗   |
| proteína por ración, error medio               | 10.4%   | ≤ 8%     | ✗   |
| ingredientes principales omitidos              | 8.7%    | ≤ 1%     | ✗   |
| mismo plato → mismas cifras (CV entre pasadas) | 3.8%    | ≤ 0%     | ✗   |

Sesgo de kcal (con signo): +6.6 % · carbohidratos: 14 % · grasa: 17.8 % · aceite: ±1.7 g · inventados por plato: 0.4 · pasadas sin descomponer (fuera de las métricas): 1/225
Latencia: 1064.0 s por pasada completa (lotes de 8).

### Frente a la línea base (2026-09-24, `openai/gpt-5`)

| Métrica                                        | Base    | Ahora   |
| ---------------------------------------------- | ------- | ------- |
| kcal por ración, error medio                   | 23.2%   | 10.8%   |
| kcal por ración, P90                           | 44.5%   | 25%     |
| kcal por 100 g, error medio                    | 5.2%    | 12.6%   |
| reparto de macros                              | 5.3 pts | 4.7 pts |
| proteína por ración, error medio               | 23.3%   | 10.4%   |
| ingredientes principales omitidos              | 9.2%    | 8.7%    |
| mismo plato → mismas cifras (CV entre pasadas) | 3.9%    | 3.8%    |

### Los 15 platos con más error de kcal

| Plato                                                                  | Ref. | Salida | Error | CV   | Motivo                                                                                   |
| ---------------------------------------------------------------------- | ---- | ------ | ----- | ---- | ---------------------------------------------------------------------------------------- |
| Pimientos rellenos de arroz y verduras ·                               | 295  | 438    | +49 % | 7 %  | arroz-blanco +40 % en gramos                                                             |
| Crema de calabacín y zanahoria ·                                       | 126  | 186    | +47 % | 6 %  | aceite +25 % en gramos · densidad -22 %                                                  |
| Pollo al curry con arroz integral ·                                    | 533  | 764    | +43 % | 6 %  | arroz-integral +40 % en gramos                                                           |
| Gachas de avena con fruta y frutos secos ·                             | 385  | 500    | +30 % | 11 % | inventa aceite · avena +17 % en gramos · densidad +22 %                                  |
| Tostada integral con aguacate y tomate ·                               | 211  | 271    | +29 % | 0 %  | inventa aceite · aceite +5 g · densidad +16 %                                            |
| Yogur natural con naranja ·                                            | 142  | 104    | -26 % | 0 %  | error repartido, sin una causa dominante                                                 |
| Tostada integral con aguacate y huevo ·                                | 275  | 344    | +25 % | 4 %  | inventa aceite · aceite +6 g                                                             |
| Plátano ·                                                              | 107  | 134    | +25 % | 0 %  | platano +25 % en gramos                                                                  |
| Crema de calabacín con picatostes de pan integral ·                    | 188  | 234    | +25 % | 1 %  | densidad -28 %                                                                           |
| Patatas guisadas con merluza y verduras ·                              | 363  | 450    | +24 % | 1 %  | error repartido, sin una causa dominante                                                 |
| Bocadillo de tortilla ·                                                | 484  | 598    | +24 % | 9 %  | aceite +6 g · pan-blanco -17 % en gramos                                                 |
| Tapas: patatas bravas y croquetas ·                                    | 607  | 468    | -23 % | 9 %  | omite patata-frita · inventa patata, croqueta · densidad -28 %                           |
| Tostada integral con tomate y huevo revuelto ·                         | 229  | 277    | +21 % | 0 %  | aceite +5 g                                                                              |
| Lentejas guisadas con arroz integral ·                                 | 346  | 417    | +20 % | 9 %  | lentejas -30 % en gramos · densidad -29 %                                                |
| Menú del día: ensalada mixta, filete con patatas fritas, pan y fruta · | 940  | 748    | -20 % | 5 %  | omite patata-frita, naranja · inventa atun-lata-aceite, patata, manzana · densidad -17 % |

_· = receta de referencia aún sin revisar a mano._

#### Dónde están las kcal (1.ª pasada; gramos ref. → salida, kcal de diferencia)

- **Pimientos rellenos de arroz y verduras**: arroz-blanco 138→194 g (+72) · aceite 4→8 g (+35) · tomate-triturado 0→100 g (+32) · tomate 80→0 g (-14) · calabacin 0→80 g (+14) · pimiento 150→200 g (+13)
- **Crema de calabacín y zanahoria**: calabacin 110→250 g (+24) · aceite 8→10 g (+18) · zanahoria 60→100 g (+16) · cebolla 30→0 g (-12)
- **Pollo al curry con arroz integral**: leche-coco 50→120 g (+138) · arroz-integral 164→229 g (+73) · tomate-triturado 50→120 g (+22) · aceite 8→10 g (+18) · cebolla 50→80 g (+12) · especias 3→0 g (-7)
- **Gachas de avena con fruta y frutos secos**: aceite 0→10 g (+88) · frutos-secos-mix 15→25 g (+60) · avena 40→50 g (+38)
- **Tostada integral con aguacate y tomate**: aceite 0→5 g (+44) · aguacate 50→60 g (+16)
- **Yogur natural con naranja**: naranja 140→60 g (-38)
- **Tostada integral con aguacate y huevo**: aceite 0→5 g (+44) · aguacate 50→60 g (+16)
- **Plátano**: platano 120→150 g (+27)
- **Crema de calabacín con picatostes de pan integral**: pan-integral 20→30 g (+25) · calabacin 170→300 g (+22) · cebolla 30→60 g (+12) · aceite 11→10 g (-9)
- **Patatas guisadas con merluza y verduras**: zanahoria 0→60 g (+25) · patata 156→178 g (+19) · merluza 115→135 g (+18) · cebolla 30→60 g (+12) · pimiento 30→60 g (+8)
- **Bocadillo de tortilla**: huevo 51→100 g (+70) · aceite 8→14 g (+53) · cebolla 22→0 g (-9)
- **Tapas: patatas bravas y croquetas**: patata-frita 150→0 g (-285) · croqueta 0→120 g (+236) · patata 0→134 g (+117) · harina 12→0 g (-44) · mantequilla 6→0 g (-43) · leche-entera 50→0 g (-31)
- **Tostada integral con tomate y huevo revuelto**: aceite 3→8 g (+44)
- **Lentejas guisadas con arroz integral**: arroz-integral 66→115 g (+55) · aceite 7→10 g (+27) · lentejas 152→137 g (-18) · zanahoria 30→60 g (+12) · cebolla 20→50 g (+12) · liquido 150→300 g (+9)
- **Menú del día: ensalada mixta, filete con patatas fritas, pan y fruta**: patata-frita 150→0 g (-285) · patata 0→160 g (+139) · atun-lata-aceite 0→50 g (+95) · manzana 0→150 g (+78) · naranja 140→0 g (-66) · huevo 25→0 g (-36)
