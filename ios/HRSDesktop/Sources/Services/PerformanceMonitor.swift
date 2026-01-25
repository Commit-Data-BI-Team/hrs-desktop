import Foundation

final class PerformanceMonitor {
    static let shared = PerformanceMonitor()

    private let queue = DispatchQueue(label: "hrs.performance.monitor")
    private var timer: DispatchSourceTimer?
    private var deferUntil: Date = .distantPast
    private let stallThreshold: TimeInterval = 0.12
    private let deferWindow: TimeInterval = 1.0

    private init() {}

    var shouldDeferHeavyWork: Bool {
        Date() < deferUntil
    }

    func start() {
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let start = Date()
            DispatchQueue.main.async {
                let latency = Date().timeIntervalSince(start)
                if latency > self.stallThreshold {
                    self.deferUntil = Date().addingTimeInterval(self.deferWindow)
                }
            }
        }
        timer.resume()
        self.timer = timer
    }
}
