/* Gravity Hollow — content translations (challenges, Learn lessons, achievements).
 * Same row format as strings.js: [English key, es-419, de-DE, fr-FR, pt-BR, it-IT].
 */
(function (root) {
  'use strict';
  var ROWS = [
    ["Sprint Hollow","Hueco exprés","Sprint-Senke","Creux sprint","Vazio expresso","Vuoto sprint"],
    ["Only 45 seconds. Make every route count.","Solo 45 segundos. Que cada ruta cuente.","Nur 45 Sekunden. Jede Route zählt.","Seulement 45 secondes. Chaque trajet compte.","Só 45 segundos. Faça cada rota valer.","Solo 45 secondi. Ogni percorso conta."],
    ["No Boost Bout","Combate sin impulso","Runde ohne Boost","Duel sans turbo","Luta sem impulso","Sfida senza scatto"],
    ["Boost is disabled. Win on lines, not bursts.","El impulso está desactivado. Gana con buenas rutas, no con arranques.","Boost ist deaktiviert. Gewinne mit Linien, nicht mit Sprints.","Le turbo est désactivé. Gagnez par les trajectoires, pas par les accélérations.","O impulso está desativado. Vença com boas rotas, não com arrancadas.","Lo scatto è disattivato. Vinci con le traiettorie, non con le accelerazioni."],
    ["Three Bursts","Tres arranques","Drei Schübe","Trois élans","Três arrancadas","Tre scatti"],
    ["You may boost exactly three times.","Puedes usar el impulso exactamente tres veces.","Du darfst genau dreimal boosten.","Vous pouvez utiliser le turbo exactement trois fois.","Você pode usar o impulso exatamente três vezes.","Puoi usare lo scatto esattamente tre volte."],
    ["Measured Steps","Pasos medidos","Bemessene Schritte","Pas mesurés","Passos medidos","Passi misurati"],
    ["A strict move limit: 25 seconds of movement.","Un límite estricto: 25 segundos de movimiento.","Ein striktes Limit: 25 Sekunden Bewegung.","Une limite stricte : 25 secondes de mouvement.","Um limite rígido: 25 segundos de movimento.","Un limite rigido: 25 secondi di movimento."],
    ["Gem Rush","Fiebre de gemas","Edelsteinrausch","Ruée vers les gemmes","Corrida das gemas","Corsa alle gemme"],
    ["Gems are everywhere — so are rivals.","Hay gemas por todas partes… y rivales también.","Überall Edelsteine – und überall Rivalen.","Des gemmes partout — et des rivaux aussi.","Gemas por toda parte — e rivais também.","Gemme ovunque — e anche rivali."],
    ["Ember Gauntlet","Desafío de brasas","Glut-Spießrutenlauf","Épreuve des braises","Desafio das brasas","Prova delle braci"],
    ["The plaza is littered with embers.","La plaza está sembrada de brasas.","Der Platz ist übersät mit Glut.","La place est jonchée de braises.","A praça está cheia de brasas.","La piazza è disseminata di braci."],
    ["Leviathan Tank","Tanque del leviatán","Leviathan-Becken","Bassin du léviathan","Tanque do leviatã","Vasca del leviatano"],
    ["Rivals start huge. Grow fast or be lunch.","Los rivales empiezan enormes. Crece rápido o serás el almuerzo.","Die Rivalen starten riesig. Wachse schnell oder werde gefressen.","Les rivaux démarrent énormes. Grandissez vite ou finissez en casse-croûte.","Os rivais começam enormes. Cresça rápido ou vire almoço.","I rivali partono enormi. Cresci in fretta o finirai a pranzo."],
    ["Cramped Court","Cancha estrecha","Enger Hof","Cour exiguë","Quadra apertada","Cortile angusto"],
    ["A tiny arena. Nowhere to hide.","Una arena diminuta. No hay dónde esconderse.","Eine winzige Arena. Kein Versteck.","Une arène minuscule. Nulle part où se cacher.","Uma arena minúscula. Nenhum lugar para se esconder.","Un’arena minuscola. Nessun posto dove nascondersi."],
    ["Drift","Deriva","Treiben","Dérive","Deriva","Deriva"],
    ["You are a hollow — a small hungry void. Move with WASD, arrow keys, or drag on the plaza.","Eres un hueco: un pequeño vacío hambriento. Muévete con WASD, las flechas o arrastrando sobre la plaza.","Du bist eine Senke – eine kleine hungrige Leere. Bewege dich mit WASD, den Pfeiltasten oder durch Ziehen auf dem Platz.","Vous êtes un creux — un petit vide affamé. Déplacez-vous avec ZQSD/WASD, les flèches, ou en glissant sur la place.","Você é um vazio — um pequeno vácuo faminto. Mova-se com WASD, as setas ou arrastando na praça.","Sei un vuoto — un piccolo vuoto affamato. Muoviti con WASD, le frecce o trascinando sulla piazza."],
    ["Hold any direction to drift.","Mantén cualquier dirección para deslizarte.","Halte eine Richtung, um zu treiben.","Maintenez une direction pour dériver.","Segure qualquer direção para deslizar.","Tieni premuta una direzione per scivolare."],
    ["Good. Drift to each glowing marker.","Bien. Deslízate hasta cada marcador brillante.","Gut. Treib zu jeder leuchtenden Markierung.","Bien. Dérivez jusqu’à chaque repère lumineux.","Ótimo. Deslize até cada marcador brilhante.","Bene. Scivola fino a ogni segnale luminoso."],
    ["Follow the bright rings.","Sigue los anillos brillantes.","Folge den hellen Ringen.","Suivez les anneaux lumineux.","Siga os anéis brilhantes.","Segui gli anelli luminosi."],
    ["Nibble","Mordisco","Knabbern","Grignoter","Beliscar","Spuntino"],
    ["Pale motes are smaller than you. Roll over them to consume.","Las motas pálidas son más pequeñas que tú. Pasa por encima para consumirlas.","Blasse Stäubchen sind kleiner als du. Rolle über sie, um sie zu verschlingen.","Les poussières pâles sont plus petites que vous. Roulez dessus pour les consommer.","Partículas claras são menores que você. Passe por cima para consumi-las.","I granelli pallidi sono più piccoli di te. Passaci sopra per consumarli."],
    ["Anything dimmer than you is food.","Todo lo que brille menos que tú es comida.","Alles, was schwächer leuchtet als du, ist Futter.","Tout ce qui brille moins que vous est de la nourriture.","Tudo que brilha menos que você é comida.","Tutto ciò che brilla meno di te è cibo."],
    ["Consume 10 motes. Watch your hollow swell.","Consume 10 motas. Mira cómo crece tu hueco.","Verschlinge 10 Stäubchen. Sieh zu, wie deine Senke wächst.","Consommez 10 poussières. Regardez votre creux enfler.","Consuma 10 partículas. Veja seu vazio inchar.","Consuma 10 granelli. Guarda il tuo vuoto gonfiarsi."],
    ["Bigger hollow, bigger appetite.","Hueco más grande, más apetito.","Größere Senke, größerer Hunger.","Creux plus gros, plus d’appétit.","Vazio maior, mais apetite.","Vuoto più grande, più appetito."],
    ["Appetite","Apetito","Appetit","Appétit","Apetite","Appetito"],
    ["Chonky morsels need a bigger hollow. Eat small first, then medium.","Los bocados gorditos necesitan un hueco más grande. Come primero lo pequeño y luego lo mediano.","Dicke Brocken brauchen eine größere Senke. Friss erst Kleines, dann Mittleres.","Les gros morceaux exigent un creux plus grand. Mangez d’abord petit, puis moyen.","Pedaços gordinhos pedem um vazio maior. Coma o pequeno primeiro, depois o médio.","I bocconi grossi richiedono un vuoto più grande. Mangia prima il piccolo, poi il medio."],
    ["Outlines show what you can eat right now.","Los contornos muestran lo que puedes comer ahora.","Umrisse zeigen, was du gerade fressen kannst.","Les contours montrent ce que vous pouvez manger maintenant.","Os contornos mostram o que você pode comer agora.","I contorni mostrano cosa puoi mangiare adesso."],
    ["Now grow until you can swallow a boulder.","Ahora crece hasta que puedas tragarte una roca.","Wachse jetzt, bis du einen Felsen verschlingen kannst.","Grandissez maintenant jusqu’à pouvoir avaler un rocher.","Agora cresça até conseguir engolir uma rocha.","Ora cresci finché non riesci a inghiottire un masso."],
    ["Boulders highlight once you are big enough.","Las rocas se resaltan cuando eres lo bastante grande.","Felsen werden hervorgehoben, sobald du groß genug bist.","Les rochers sont surlignés dès que vous êtes assez gros.","As rochas ficam destacadas quando você é grande o bastante.","I massi si evidenziano quando sei abbastanza grande."],
    ["Ember & Boost","Brasa e impulso","Glut & Boost","Braise et turbo","Brasa e impulso","Brace e scatto"],
    ["Orange embers burn — they shrink you. Avoid them and eat 3 gems.","Las brasas naranjas queman: te encogen. Evítalas y come 3 gemas.","Orange Glut verbrennt – du schrumpfst. Weich ihr aus und friss 3 Edelsteine.","Les braises orange brûlent — elles vous rétrécissent. Évitez-les et mangez 3 gemmes.","Brasas laranja queimam — elas encolhem você. Evite-as e coma 3 gemas.","Le braci arancioni bruciano — ti rimpiccioliscono. Evitale e mangia 3 gemme."],
    ["Gems gleam. Embers smolder.","Las gemas brillan. Las brasas arden.","Edelsteine glänzen. Glut glimmt.","Les gemmes scintillent. Les braises couvent.","Gemas reluzem. Brasas ardem.","Le gemme brillano. Le braci covano."],
    ["Hold SHIFT (or the BOOST button) to surge. Boosting spends mass — use it twice.","Mantén MAYÚS (o el botón de IMPULSO) para acelerar. El impulso gasta masa: úsalo dos veces.","Halte UMSCHALT (oder die BOOST-Taste), um loszusprinten. Boosten kostet Masse – nutze es zweimal.","Maintenez MAJ (ou le bouton TURBO) pour foncer. Le turbo coûte de la masse — utilisez-le deux fois.","Segure SHIFT (ou o botão IMPULSO) para acelerar. O impulso gasta massa — use duas vezes.","Tieni premuto MAIUSC (o il pulsante SCATTO) per accelerare. Lo scatto consuma massa — usalo due volte."],
    ["Boost is a spending, not a gift.","El impulso es un gasto, no un regalo.","Boost kostet etwas, er ist kein Geschenk.","Le turbo est une dépense, pas un cadeau.","O impulso é um gasto, não um presente.","Lo scatto è una spesa, non un regalo."],
    ["Pip is another hollow. Outgrow them, then swallow them whole.","Pip es otro hueco. Hazte más grande y trágatelo entero.","Pip ist eine andere Senke. Wachse über Pip hinaus und verschlinge Pip ganz.","Pip est un autre creux. Dépassez-le en taille, puis avalez-le tout rond.","Pip é outro vazio. Fique maior e engula Pip inteiro.","Pip è un altro vuoto. Diventa più grande e inghiottilo intero."],
    ["You must outweigh them by a quarter.","Debes pesar un cuarto más.","Du musst ein Viertel schwerer sein.","Vous devez peser un quart de plus.","Você precisa pesar um quarto a mais.","Devi pesare un quarto in più."],
    ["Now outscore Pip before the clock runs out.","Ahora supera a Pip antes de que se acabe el tiempo.","Übertriff jetzt Pip, bevor die Zeit abläuft.","Battez maintenant Pip avant la fin du chrono.","Agora supere Pip antes que o tempo acabe.","Ora supera Pip prima che scada il tempo."],
    ["Mass collected decides the winner.","La masa reunida decide quién gana.","Die gesammelte Masse entscheidet.","La masse collectée désigne le vainqueur.","A massa coletada decide o vencedor.","La massa raccolta decide il vincitore."],
    ["First Hollow","Primer hueco","Erste Senke","Premier creux","Primeiro vazio","Primo vuoto"],
    ["Finish your first match.","Termina tu primera partida.","Beende dein erstes Match.","Terminez votre première partie.","Termine sua primeira partida.","Finisci la tua prima partita."],
    ["Full Toolkit","Kit completo","Voller Werkzeugkasten","Panoplie complète","Kit completo","Kit completo"],
    ["Eat a prop, a gem, and a rival, and boost — in one match.","Come un objeto, una gema y un rival, y usa el impulso, en una sola partida.","Friss ein Objekt, einen Edelstein und einen Rivalen und booste – in einem Match.","Mangez un objet, une gemme et un rival, et utilisez le turbo — en une seule partie.","Coma um objeto, uma gema e um rival, e use o impulso — numa só partida.","Mangia un oggetto, una gemma e un rivale, e usa lo scatto — in una sola partita."],
    ["Habit Forming","Creando el hábito","Gewohnheitssache","Prendre le pli","Criando o hábito","Diventa un’abitudine"],
    ["Play on three different days.","Juega en tres días distintos.","Spiele an drei verschiedenen Tagen.","Jouez trois jours différents.","Jogue em três dias diferentes.","Gioca in tre giorni diversi."],
    ["Half the Hollow","La mitad del hueco","Halbe Senke","La moitié du creux","Metade do vazio","Metà del vuoto"],
    ["Clear 20 Journey stages.","Supera 20 etapas de la Travesía.","Schaffe 20 Etappen der Reise.","Réussissez 20 étapes du Périple.","Conclua 20 fases da Jornada.","Completa 20 tappe del Viaggio."],
    ["Mastery Proven","Maestría demostrada","Meisterschaft bewiesen","Maîtrise prouvée","Maestria comprovada","Maestria dimostrata"],
    ["Clear a Journey mastery stage.","Supera una etapa de maestría de la Travesía.","Schaffe eine Meisterprüfung der Reise.","Réussissez une étape de maîtrise du Périple.","Conclua uma fase de maestria da Jornada.","Completa una tappa di maestria del Viaggio."],
    ["Quiet Giant","Gigante tranquilo","Stiller Riese","Géant tranquille","Gigante tranquilo","Gigante tranquillo"],
    ["Finish a match with 300+ mass and zero deaths.","Termina una partida con más de 300 de masa y sin morir.","Beende ein Match mit 300+ Masse und ohne Tod.","Terminez une partie avec 300+ de masse et sans mourir.","Termine uma partida com 300+ de massa e sem morrer.","Finisci una partita con 300+ di massa e senza morire."],
    ["Regular at the Plaza","Habitual de la plaza","Stammgast am Platz","Habitué de la place","Frequentador da praça","Habitué della piazza"],
    ["Play 25 sessions.","Juega 25 sesiones.","Spiele 25 Sitzungen.","Jouez 25 sessions.","Jogue 25 sessões.","Gioca 25 sessioni."]
  ];
  var S = root.GH_STRINGS = root.GH_STRINGS || {};
  S['es-ES'] = S['es-ES'] || {};
  S['es-ES']['Cramped Court'] = 'Pista estrecha';
  ['es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT'].forEach(function (l, i) {
    var t = S[l] = S[l] || {};
    ROWS.forEach(function (r) { t[r[0]] = r[i + 1]; });
  });
})(typeof self !== 'undefined' ? self : this);
