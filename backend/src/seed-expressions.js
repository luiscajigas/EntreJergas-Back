/**
 * Expresiones revisadas a mano. Cada fila contiene: forma normalizada, expresión, significado,
 * región, contexto, equivalente, ejemplo, países y nivel de lenguaje.
 */
const seedExpressions = [
  ['parcero', 'parcero', 'Amigo cercano o compañero.', 'Antioquia y región Andina', 'Informal y amistoso; se usa para dirigirse a alguien de confianza.', 'amigo', 'Ese parcero siempre está cuando lo necesito.', ['CO'], 'informal'],
  ['parce', 'parce', 'Forma abreviada de parcero: amigo o compañero.', 'Antioquia y región Andina', 'Muy informal y frecuente entre jóvenes y amigos.', 'amigo', 'Parce, ¿vamos por un café?', ['CO'], 'informal'],
  ['que chimba', 'qué chimba', 'Algo muy bueno, emocionante o admirable.', 'Antioquia y región Andina', 'Informal; expresa entusiasmo. Puede ser vulgar según el contexto.', 'qué genial', '¡Qué chimba ese concierto!', ['CO'], 'vulgar'],
  ['chimba', 'chimba', 'Algo excelente o, según el contexto, algo sin importancia.', 'Antioquia y región Andina', 'Jerga informal. El sentido depende del tono y la situación.', 'genial', 'La película estuvo una chimba.', ['CO'], 'vulgar'],
  ['bacano', 'bacano', 'Agradable, bueno o que gusta mucho.', 'Caribe y región Andina', 'Informal y positivo; común en conversaciones cotidianas.', 'chévere', 'El plan estuvo muy bacano.', ['CO'], 'informal'],
  ['chevere', 'chévere', 'Bueno, agradable o interesante.', 'Caribe y otros países de Latinoamérica', 'Informal; se usa para expresar aprobación.', 'genial', 'Tu idea suena chévere.', ['CO', 'VE', 'EC', 'PE', 'PA'], 'informal'],
  ['berraco', 'berraco', 'Persona valiente, capaz o muy trabajadora; también algo difícil.', 'Santander y región Andina', 'Informal; cambia de sentido según la frase.', 'muy capaz', 'Mi abuela es una berraca.', ['CO'], 'informal'],
  ['camellar', 'camellar', 'Trabajar, especialmente con esfuerzo.', 'Colombia', 'Informal; habitual en conversaciones sobre trabajo.', 'trabajar', 'Mañana me toca camellar temprano.', ['CO'], 'informal'],
  ['guayabo', 'guayabo', 'Malestar del día siguiente a haber tomado alcohol; también tristeza.', 'Colombia', 'Coloquial; el sentido se entiende por el contexto.', 'resaca', 'Después de la fiesta amaneció con guayabo.', ['CO'], 'informal'],
  ['vaina', 'vaina', 'Cosa, asunto o situación cuyo nombre no se especifica.', 'Caribe y región Andina', 'Muy coloquial; puede expresar molestia o sorpresa.', 'cosa', 'Pásame esa vaina que está en la mesa.', ['CO', 'VE'], 'informal'],
  ['paila', 'paila', 'Expresión para indicar que algo salió mal o se perdió.', 'Colombia', 'Informal; suele expresar resignación.', 'qué mal', 'Llegamos tarde y ya cerraron: paila.', ['CO'], 'informal'],
  ['tinto', 'tinto', 'Café negro servido en una porción pequeña.', 'Colombia', 'Uso cotidiano; no significa vino tinto en este contexto.', 'café negro', '¿Me regalas un tinto, por favor?', ['CO'], 'neutral'],
  ['mamar gallo', 'mamar gallo', 'Bromear, tomar del pelo o no actuar con seriedad.', 'Caribe colombiano', 'Informal y juguetón entre personas de confianza.', 'bromear', 'Deja de mamar gallo y ayúdame.', ['CO', 'VE'], 'informal'],
  ['dar papaya', 'dar papaya', 'Exponerse innecesariamente a un riesgo o facilitar que algo ocurra.', 'Colombia', 'Coloquial; suele usarse como recomendación preventiva.', 'exponerse', 'No dejes el celular solo, no des papaya.', ['CO'], 'informal'],
  ['rumba', 'rumba', 'Fiesta o salida para bailar y divertirse.', 'Caribe y Colombia', 'Informal; se usa para hablar de salir de fiesta.', 'fiesta', 'El sábado hay rumba en el barrio.', ['CO', 'VE', 'CU'], 'informal'],
  ['chichai', 'chichai', 'Expresión regional cuyo significado depende de la zona y del contexto.', 'Por confirmar', 'Regionalismo pendiente de documentar; cuéntanos dónde lo escuchaste.', 'Por confirmar', '¿En qué contexto escuchaste “chichai”?', [], null],
  ['boludo', 'boludo', 'Persona tonta o torpe; entre amigos también se usa como trato de confianza.', 'Río de la Plata', 'Muy frecuente. Es un insulto o un saludo amistoso según el tono y la confianza.', 'tonto', '¡Dale, boludo, que llegamos tarde!', ['AR', 'UY'], 'vulgar'],
  ['che', 'che', 'Palabra para llamar la atención de alguien o dirigirse a esa persona.', 'Río de la Plata', 'Informal y muy común en la conversación diaria.', 'oye', 'Che, ¿venís a comer?', ['AR', 'UY'], 'informal'],
  ['pibe', 'pibe', 'Niño o joven, generalmente varón.', 'Río de la Plata', 'Coloquial; no suele ser ofensivo.', 'muchacho', 'Ese pibe juega muy bien al fútbol.', ['AR', 'UY'], 'informal'],
  ['guey', 'güey', 'Forma de dirigirse a un amigo; también puede significar tonto.', 'México', 'Muy informal. Según el tono es amistoso u ofensivo.', 'amigo', '¿Qué onda, güey? ¿Vienes o no?', ['MX'], 'vulgar'],
  ['chido', 'chido', 'Algo muy bueno, agradable o bien hecho.', 'México', 'Informal y positivo.', 'genial', 'Está bien chido tu carro.', ['MX'], 'informal'],
  ['la neta', 'la neta', 'La verdad; se usa para hablar con franqueza.', 'México', 'Informal; suele introducir una opinión sincera.', 'la verdad', 'La neta, no me gustó la película.', ['MX'], 'informal'],
  ['chamo', 'chamo', 'Niño o joven; también sirve para dirigirse a un amigo.', 'Venezuela', 'Informal y muy común.', 'muchacho', 'Chamo, ¿cómo estás?', ['VE'], 'informal'],
  ['pana', 'pana', 'Amigo cercano o compañero de confianza.', 'Venezuela, Ecuador y Panamá', 'Informal y amistoso.', 'amigo', 'Él es mi pana desde el colegio.', ['VE', 'EC', 'PA'], 'informal'],
  ['weon', 'weón', 'Persona tonta; entre amigos también se usa como trato de confianza.', 'Chile', 'Muy frecuente. Es vulgar y puede ser ofensivo según el tono.', 'tonto', 'Oye, weón, ¿dónde estái?', ['CL'], 'vulgar'],
  ['cachai', 'cachai', 'Muletilla para preguntar si la otra persona entiende.', 'Chile', 'Informal; se usa al final de una frase.', '¿entiendes?', 'Es complicado, ¿cachai?', ['CL'], 'informal'],
  ['tio', 'tío', 'Forma de dirigirse a un amigo o de referirse a cualquier hombre.', 'España', 'Coloquial; también significa hermano del padre o de la madre.', 'amigo', 'Tío, ¿has visto eso?', ['ES'], 'informal'],
  ['guay', 'guay', 'Algo muy bueno, atractivo o agradable.', 'España', 'Informal y positivo.', 'genial', 'Tu chaqueta es muy guay.', ['ES'], 'informal'],
  ['pura vida', 'pura vida', 'Expresa que todo está bien; también se usa como saludo o agradecimiento.', 'Costa Rica', 'Informal; es una expresión muy identificada con el país.', 'todo bien', '¿Cómo estás? ¡Pura vida!', ['CR'], 'informal'],
  ['mae', 'mae', 'Forma de dirigirse a un amigo o de referirse a una persona.', 'Costa Rica', 'Informal y muy común.', 'amigo', 'Mae, ¿vamos a la playa?', ['CR'], 'informal'],
  ['asere', 'asere', 'Forma de dirigirse a un amigo.', 'Cuba', 'Informal y muy común entre conocidos.', 'amigo', '¿Qué bolá, asere?', ['CU'], 'informal']
];

module.exports = { seedExpressions };
