# Modo Bakuchi (trampas) — propuesta de diseño

> **Estado:** idea, todavía sin implementar. Este documento recoge la propuesta
> inicial. Los números de balance (probabilidades, castigos y calor) quedan
> pendientes para el documento de diseño detallado.

Un modo de juego aparte, al estilo de *Tetsuya*, en el que los jugadores pueden
hacer trampas físicas con la mesa (el muro, los dados, el reparto) y los rivales
pueden vigilarlas y acusarlas. Igual que el modo **Por equipos**, es un modo
separado (nombre provisional: «Modo Bakuchi» o «Modo Tetsuya»). **El ranked
clásico queda limpio.**

## 1. Cada trampa tiene ejecución, señal y castigo

Cada técnica pasa por tres momentos:

- **Ejecución:** un minijuego breve de habilidad, por ejemplo un ritmo, un trazo
  o un timing. Su calidad define cuánto ayuda la trampa y cuánto se nota.
- **Señal visible (*tell*):** cada trampa deja un indicio en la mesa que un rival
  atento puede ver. Por ejemplo, una pila del muro un poco desalineada, una mano
  que «duda», una ficha que brilla un instante o un dado que rebota raro. Las 4
  fases del reparto en 3D (revolver, armar muros, dados y repartir) son el lugar
  natural para estas señales.
- **Castigo:** si te descubren, pagas **chombo** (por ejemplo un mangan a cada
  rival) y la mano se anula o pierdes el derecho a ganarla.

Así la probabilidad de éxito no es un dado ciego: depende de **qué tan bien lo
hiciste** y de **cuánta gente te estaba mirando**.

## 2. La contrajugada: atención y acusación

### Atención

Cada jugador puede **vigilar** a un rival, por ejemplo manteniendo el cursor o el
dedo sobre su retrato (encaja con los retratos de arriba al estilo Tetsuya).

- Vigilar **te cuesta algo**: menos tiempo de turno, o no ver tu propia ayuda
  visual mientras miras.
- Si vigilas a quien hace trampa, **sus señales se vuelven más evidentes** y su
  probabilidad de fallar sube.

### Acusación («¡Trampa!»)

- **Si aciertas:** el tramposo paga el chombo y tú cobras una parte.
- **Si te equivocas:** pagas tú una multa.

Acusar es también una apuesta, lo que evita que la gente acuse a todo por si
acaso.

## 3. Que no se pueda abusar

- **Calor (*heat*):** cada trampa, salga bien o mal, sube tu nivel de sospecha,
  que es **público** (por ejemplo, un aura en tu retrato). Con más calor, tus
  señales se ven más y las acusaciones contra ti cuestan menos. El calor baja
  despacio jugando limpio. Esto hace inviable spamear trampas.
- **Rendimientos decrecientes:** la segunda trampa en la misma mano es mucho más
  difícil que la primera.
- **Preparación en varios pasos para las técnicas grandes:** por ejemplo, el
  *tsubame gaeshi* exige haber armado antes un tramo del muro (*tsumikomi*) y
  después ejecutar el cambio en el momento justo. Cada paso abre una ventana
  para que te pillen. Un yakuman garantizado debería ser casi imposible de
  lograr limpio frente a rivales atentos.
- **Poder acotado:** la mayoría de las trampas dan ventajas pequeñas, como
  mejorar 1 o 2 fichas, ver la siguiente ficha del muro o mover un indicador de
  dora; no manos hechas. La gracia es acumular ventajas pequeñas sin que te
  descubran.

## 4. Técnicas posibles, atadas a las fases del reparto

| Fase | Técnica | Efecto | Señal visible |
| --- | --- | --- | --- |
| Revolver | Guardar fichas | Retienes 1–2 fichas que eliges | Tus fichas se mueven distinto en el remolino |
| Armar muros | *Tsumikomi* | Ordenas algunas fichas de tu tramo del muro | Pila desalineada o que se arma más lento |
| Dados | Dados cargados | Eliges el punto de corte del muro | Rebote raro; el dado «frena» de golpe |
| Repartir | Robar de más / cambiar un bloque | Mejoras un bloque de 4 | El bloque viaja con otra trayectoria |
| En partida | *Surikae* (cambiar una ficha de la mano por una del muro) | Cambio puntual | Tu mano tiembla; hay un hueco en el muro |
| En partida | *Tsubame gaeshi* | Cambias la mano entera por un tramo preparado del muro | Muy visible; solo es viable con calor bajo y nadie vigilándote |

### Por equipos

En combinación con el modo por equipos se suma la dimensión social: tu
compañero puede **distraer** (atraer la atención de los rivales) mientras tú
ejecutas la trampa.

## 5. Por qué esto es más interesante que gastar puntos

- **Hay lectura del rival:** ¿lo está vigilando a él o a mí? ¿Acuso ahora o
  espero a ver otra señal?
- **La habilidad de ejecución importa.**
- **La tensión es pública:** todos ven el calor y las acusaciones.
- **Hay riesgo real:** el chombo duele lo suficiente como para pensarlo dos
  veces.

## 6. Cómo se implementaría

- **Todo en el servidor:** las tiradas de detección, los efectos sobre el muro y
  la validación de los minijuegos. El cliente solo envía **entradas** (por
  ejemplo el timing del minijuego, con tolerancia por latencia), **nunca
  resultados**. Es importante para que nadie haga trampa de verdad con el
  código.
- **Modo de juego aparte,** como el modo Por equipos. El ranked clásico no
  cambia.
- **El motor encaja bien:** ya modela las posiciones físicas del muro, los dados
  y los bloques de reparto, así que manipular el muro dentro de ciertas reglas
  es viable.

## Próximos pasos

1. **Documento de diseño con números de balance:** probabilidades de éxito y de
   detección, tamaño del chombo y de la multa por acusación falsa, curva de
   subida y bajada del calor, y penalización por rendimientos decrecientes.
2. **Prototipo con 3 técnicas:** *tsumikomi*, dados cargados y *surikae*, más el
   sistema de vigilar y acusar.
