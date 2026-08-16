import WidgetKit
import SwiftUI

// MARK: - Datos compartidos
//
// El widget lee un "snapshot del día" que la app RN escribe en el App Group
// (Hito 2). En el Hito 1 aún no hay escritor, así que si no encuentra nada cae
// en `.sample` y verás datos de muestra: eso confirma que el target compila y
// se pinta sin depender todavía del puente nativo.

private let appGroup = "group.com.victorgorina.dailyguide"
private let snapshotKey = "day_snapshot"

struct DaySnapshot: Codable {
    var displayName: String
    var streak: Int          // "impulso": días con seguimiento en las últimas 3 semanas
    var doneCount: Int        // comidas resueltas hoy
    var totalMeals: Int       // comidas planificadas hoy
    var allDone: Bool
    var nextMealLabel: String // p. ej. "Comida"
    var nextIdea: String      // plato planificado para esa comida
    var quoteText: String
    var quoteAuthor: String

    var progress: Double {
        totalMeals > 0 ? Double(doneCount) / Double(totalMeals) : 0
    }

    static let sample = DaySnapshot(
        displayName: "Víctor",
        streak: 7,
        doneCount: 2,
        totalMeals: 4,
        allDone: false,
        nextMealLabel: "Comida",
        nextIdea: "Lentejas con verduras",
        quoteText: "No cuentes los días, haz que los días cuenten.",
        quoteAuthor: "Muhammad Ali"
    )

    /// Lee el snapshot del App Group; si no hay o no decodifica, usa el de muestra.
    static var current: DaySnapshot {
        guard
            let defaults = UserDefaults(suiteName: appGroup),
            let raw = defaults.string(forKey: snapshotKey),
            let data = raw.data(using: .utf8),
            let decoded = try? JSONDecoder().decode(DaySnapshot.self, from: data)
        else { return .sample }
        return decoded
    }
}

// MARK: - Timeline

struct DayEntry: TimelineEntry {
    let date: Date
    let snapshot: DaySnapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        completion(DayEntry(date: Date(), snapshot: .current))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        // Una sola entrada. La app recarga el timeline vía WidgetCenter cuando
        // cambian los datos (Hito 2), así que no necesitamos refresco periódico.
        let entry = DayEntry(date: Date(), snapshot: .current)
        completion(Timeline(entries: [entry], policy: .never))
    }
}

// MARK: - Paleta (tema "niebla" de la app)

private extension Color {
    init(hex: UInt) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: 1
        )
    }
    static let dgForeground = Color(hex: 0x1d2a37)
    static let dgPrimary = Color(hex: 0x4f8ac6)
    static let dgMuted = Color(hex: 0x677380)
    static let dgSuccess = Color(hex: 0x4aa969)
    static let dgFlame = Color(hex: 0xe19600)
    static let dgBackground = Color(hex: 0xf6fafd)
}

// MARK: - Vistas

/// Anillo de progreso de las comidas del día.
struct ProgressRing: View {
    let progress: Double
    let done: Bool

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.dgPrimary.opacity(0.15), lineWidth: 7)
            Circle()
                .trim(from: 0, to: max(0.001, progress))
                .stroke(
                    done ? Color.dgSuccess : Color.dgPrimary,
                    style: StrokeStyle(lineWidth: 7, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            if done {
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.dgSuccess)
            } else {
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.dgForeground)
            }
        }
    }
}

/// Píldora de racha (impulso) con la llama.
struct StreakPill: View {
    let streak: Int
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "flame.fill")
                .font(.system(size: 11, weight: .semibold))
            Text("\(streak)")
                .font(.system(size: 12, weight: .bold))
        }
        .foregroundStyle(Color.dgFlame)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.dgFlame.opacity(0.12), in: Capsule())
    }
}

struct SmallWidgetView: View {
    let s: DaySnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                StreakPill(streak: s.streak)
                Spacer()
                ProgressRing(progress: s.progress, done: s.allDone)
                    .frame(width: 34, height: 34)
            }
            Spacer(minLength: 6)
            if s.allDone {
                Text("Día completo")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.dgSuccess)
                Text("Bien hecho.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.dgMuted)
            } else {
                Text("Siguiente · \(s.nextMealLabel)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.dgPrimary)
                Text(s.nextIdea)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.dgForeground)
                    .lineLimit(2)
            }
        }
    }
}

struct MediumWidgetView: View {
    let s: DaySnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(s.displayName)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color.dgForeground)
                            .lineLimit(1)
                        StreakPill(streak: s.streak)
                    }
                    if s.allDone {
                        Text("Día completo · bien hecho")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.dgSuccess)
                    } else {
                        Text("Siguiente · \(s.nextMealLabel)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.dgPrimary)
                        Text(s.nextIdea)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.dgForeground)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                ProgressRing(progress: s.progress, done: s.allDone)
                    .frame(width: 44, height: 44)
            }
            Spacer(minLength: 0)
            Divider()
            Text("“\(s.quoteText)”")
                .font(.system(size: 12))
                .italic()
                .foregroundStyle(Color.dgMuted)
                .lineLimit(2)
        }
    }
}

struct DailyGuideWidgetView: View {
    @Environment(\.widgetFamily) var family
    var entry: Provider.Entry

    var body: some View {
        Group {
            switch family {
            case .systemMedium:
                MediumWidgetView(s: entry.snapshot)
            default:
                SmallWidgetView(s: entry.snapshot)
            }
        }
        .containerBackground(for: .widget) { Color.dgBackground }
        .widgetURL(URL(string: "dailyguide://hoy"))
    }
}

// MARK: - Configuración

struct DailyGuideWidget: Widget {
    let kind = "DailyGuideWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            DailyGuideWidgetView(entry: entry)
        }
        .configurationDisplayName("Tu día")
        .description("La comida que toca, tu racha y el progreso del día.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct DailyGuideWidgetBundle: WidgetBundle {
    var body: some Widget {
        DailyGuideWidget()
    }
}
