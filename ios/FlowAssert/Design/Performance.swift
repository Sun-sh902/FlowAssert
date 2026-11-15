import os

/// Signposted intervals, for Instruments and for the performance tests (XCTOSSignpostMetric): choosing a file up to
/// its profile, a check up to its result, opening a report up to the reader's answer. They carry no names or values.
enum Performance {
    static let subsystem = "io.github.sunsh902.flowassert"
    static let category = "performance"
    static let signposter = OSSignposter(subsystem: subsystem, category: category)
}
