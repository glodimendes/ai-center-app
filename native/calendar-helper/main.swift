// calendar-helper: tiny JSON bridge from the planner to macOS Calendar (EventKit).
// Google, iCloud and Exchange calendars added in System Settings → Internet Accounts all appear here,
// and changes sync back through macOS. Events the planner creates carry "[planner:<blockId>]" in
// their notes; update/delete refuse any event without that tag.
//
//   status | request | calendars | events <fromISO> <toISO> | create (stdin) | update (stdin) | delete <eventId>
import EventKit
import Foundation

let store = EKEventStore()
let TAG = "[planner:"

func out(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(code)
}

let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]
let local: DateFormatter = {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.timeZone = .current
  f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
  return f
}()

func parseDate(_ s: String) -> Date {
  if let d = iso.date(from: s) { return d }
  if let d = local.date(from: String(s.prefix(19))) { return d }
  fail("Bad date: \(s)")
}

func statusName() -> String {
  switch EKEventStore.authorizationStatus(for: .event) {
  case .fullAccess: return "fullAccess"
  case .writeOnly: return "writeOnly"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "unknown"
  }
}

func requireAccess() {
  if statusName() != "fullAccess" { fail("Calendar access not granted (\(statusName())). Allow it in System Settings → Privacy & Security → Calendars.", code: 3) }
}

func hex(_ cg: CGColor?) -> String {
  guard let c = cg, let comps = c.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)?.components, comps.count >= 3 else { return "#94a3b8" }
  return String(format: "#%02x%02x%02x", Int(comps[0] * 255), Int(comps[1] * 255), Int(comps[2] * 255))
}

func readStdin() -> [String: Any] {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { fail("Expected JSON on stdin") }
  return obj
}

/// Event ids from `events` are "<eventIdentifier>|<occurrence start>"; edits use the identifier part.
func event(_ id: String) -> EKEvent {
  let ident = String(id.split(separator: "|").first ?? "")
  guard let ev = store.event(withIdentifier: ident) else { fail("Event not found", code: 4) }
  return ev
}

func owned(_ ev: EKEvent) {
  if !(ev.notes ?? "").contains(TAG) { fail("Refusing to modify \"\(ev.title ?? "")\": not created by the planner.", code: 5) }
}

let args = CommandLine.arguments.dropFirst()
switch args.first {
case "status":
  out(["status": statusName()])

case "request":
  let sem = DispatchSemaphore(value: 0)
  store.requestFullAccessToEvents { _, _ in sem.signal() }
  sem.wait()
  out(["status": statusName()])

case "calendars":
  requireAccess()
  out(store.calendars(for: .event).map { c in
    ["id": c.calendarIdentifier, "name": c.title, "color": hex(c.cgColor), "writable": c.allowsContentModifications, "source": c.source.title] as [String: Any]
  })

case "events":
  requireAccess()
  let a = Array(args)
  guard a.count >= 3 else { fail("usage: events <from> <to>") }
  let pred = store.predicateForEvents(withStart: parseDate(a[1]), end: parseDate(a[2]), calendars: nil)
  out(store.events(matching: pred).map { e in
    [
      "id": "\(e.eventIdentifier ?? "")|\(Int(e.startDate.timeIntervalSince1970))",
      "calendarId": e.calendar.calendarIdentifier,
      "calendarName": e.calendar.title,
      "title": e.title ?? "(no title)",
      "start": iso.string(from: e.startDate),
      "end": iso.string(from: e.endDate),
      "allDay": e.isAllDay,
      "notes": e.notes ?? "",
      "free": e.availability == .free
    ] as [String: Any]
  })

case "create":
  requireAccess()
  let o = readStdin()
  guard let calId = o["calendarId"] as? String, let cal = store.calendar(withIdentifier: calId) else { fail("Unknown calendar") }
  let notes = o["notes"] as? String ?? ""
  guard notes.contains(TAG) else { fail("Planner events must carry the planner tag") }
  let ev = EKEvent(eventStore: store)
  ev.calendar = cal
  ev.title = o["title"] as? String ?? ""
  ev.startDate = parseDate(o["start"] as? String ?? "")
  ev.endDate = parseDate(o["end"] as? String ?? "")
  ev.notes = notes
  do { try store.save(ev, span: .thisEvent, commit: true) } catch { fail("Save failed: \(error.localizedDescription)") }
  out(["id": "\(ev.eventIdentifier ?? "")|\(Int(ev.startDate.timeIntervalSince1970))"])

case "update":
  requireAccess()
  let o = readStdin()
  let ev = event(o["id"] as? String ?? "")
  owned(ev)
  if let t = o["title"] as? String { ev.title = t }
  if let s = o["start"] as? String { ev.startDate = parseDate(s) }
  if let e = o["end"] as? String { ev.endDate = parseDate(e) }
  if let n = o["notes"] as? String, n.contains(TAG) { ev.notes = n }
  do { try store.save(ev, span: .thisEvent, commit: true) } catch { fail("Save failed: \(error.localizedDescription)") }
  out(["ok": true])

case "delete":
  requireAccess()
  let a = Array(args)
  guard a.count >= 2 else { fail("usage: delete <id>") }
  let ev = event(a[1])
  owned(ev)
  do { try store.remove(ev, span: .thisEvent, commit: true) } catch { fail("Delete failed: \(error.localizedDescription)") }
  out(["ok": true])

default:
  fail("usage: calendar-helper status|request|calendars|events|create|update|delete")
}
