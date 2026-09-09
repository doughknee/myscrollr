package platform

// Measured wraps a number with whether it means what its label says.
//
// It exists because of one specific failure: a dashboard that cannot measure
// something and renders 0 anyway. "0 active installs" reads as a measurement
// of zero rather than the absence of a measurement, and a reader files it
// away as a fact. When Available is false the client renders Note and must
// not render Value — not even as "0".
//
// Introduced by the staff Overview (REL-260) and lifted here when the support
// console (REL-263) needed the same promise for a hold countdown that is
// running against a pipeline which may be switched off. The JSON shape is
// unchanged; internal/admin keeps `Measured` as an alias.
type Measured struct {
	Value     int    `json:"value"`
	Available bool   `json:"available"`
	Note      string `json:"note,omitempty"`
}

// Unmeasured is the "we do not have this number" answer, with the sentence
// that says why.
func Unmeasured(note string) Measured {
	return Measured{Available: false, Note: note}
}
