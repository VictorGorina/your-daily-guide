export type Quote = {
  text: string;
  author: string;
};

export const QUOTES: Quote[] = [
  {
    text: "El que tiene un porqué para vivir puede soportar casi cualquier cómo.",
    author: "Nietzsche",
  },
  { text: "No hay viento favorable para el que no sabe a dónde va.", author: "Séneca" },
  { text: "La suerte favorece a la mente preparada.", author: "Louis Pasteur" },
  {
    text: "El éxito no es definitivo, el fracaso no es fatal: lo que cuenta es el valor para continuar.",
    author: "Winston Churchill",
  },
  { text: "Sé el cambio que quieres ver en el mundo.", author: "Mahatma Gandhi" },
  {
    text: "La vida es lo que pasa mientras estás ocupado haciendo otros planes.",
    author: "John Lennon",
  },
  { text: "Solo sé que no sé nada.", author: "Sócrates" },
  { text: "El hombre que mueve montañas empieza apartando piedras pequeñas.", author: "Confucio" },
  { text: "La disciplina es el puente entre metas y logros.", author: "Jim Rohn" },
  {
    text: "No es el más fuerte el que sobrevive, sino el que mejor se adapta al cambio.",
    author: "Charles Darwin",
  },
  { text: "Todo lo que puedas imaginar es real.", author: "Pablo Picasso" },
  { text: "La imaginación es más importante que el conocimiento.", author: "Albert Einstein" },
  {
    text: "Ninguno de nosotros, actuando solo, puede alcanzar el éxito.",
    author: "Nelson Mandela",
  },
  {
    text: "El fracaso es simplemente la oportunidad de empezar de nuevo, esta vez de forma más inteligente.",
    author: "Henry Ford",
  },
  { text: "No hay camino hacia la paz, la paz es el camino.", author: "Mahatma Gandhi" },
  { text: "Las cosas grandes nunca vienen de la comodidad.", author: "Marco Aurelio" },
  {
    text: "Un río se abre camino a través de las rocas no por su fuerza, sino por su persistencia.",
    author: "Jim Watkins",
  },
  { text: "Levántate más veces de las que caes.", author: "Confucio" },
  { text: "Nada en la vida debe ser temido, solamente comprendido.", author: "Marie Curie" },
  { text: "El que no arriesga no gana.", author: "Miguel de Cervantes" },
  { text: "La perseverancia es la madre de la buena fortuna.", author: "Miguel de Cervantes" },
  { text: "No hay nada permanente excepto el cambio.", author: "Heráclito" },
  { text: "El primer paso para conseguir algo es decidir que puedes.", author: "Nelson Mandela" },
  { text: "Cuida tu cuerpo. Es el único lugar donde tienes que vivir.", author: "Jim Rohn" },
  { text: "El conocimiento habla, pero la sabiduría escucha.", author: "Jimi Hendrix" },
  { text: "Empieza donde estás, usa lo que tengas, haz lo que puedas.", author: "Arthur Ashe" },
  {
    text: "La grandeza no se mide por lo que tienes, sino por lo que superas.",
    author: "Booker T. Washington",
  },
  { text: "El movimiento se demuestra andando.", author: "Diógenes" },
  { text: "No cuentes los días, haz que los días cuenten.", author: "Muhammad Ali" },
  { text: "La paciencia es amarga, pero su fruto es dulce.", author: "Aristóteles" },
  {
    text: "Quien tiene salud tiene esperanza, y quien tiene esperanza lo tiene todo.",
    author: "Thomas Carlyle",
  },
];

/**
 * Devuelve la frase del día: la misma durante todo el día, distinta cada día.
 */
export function quoteOfTheDay(date: Date = new Date()): Quote {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return QUOTES[dayOfYear % QUOTES.length]!;
}
