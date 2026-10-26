package support

import (
	"bytes"
	"net/url"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Rebuild untrusted replies with formatting only and a closed set of public links.
// Apply at the mail sinks too, since saved drafts can predate this policy.
func sanitizeReplyHTML(body string) string {
	root := &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body}
	nodes, err := html.ParseFragment(strings.NewReader(body), root)
	if err != nil {
		return ""
	}
	var clean func(*html.Node, *html.Node)
	clean = func(src, dst *html.Node) {
		if src.Type == html.TextNode {
			dst.AppendChild(&html.Node{Type: html.TextNode, Data: src.Data})
			return
		}
		if src.Type != html.ElementNode {
			return
		}
		switch src.Data {
		case "script", "style", "form", "svg", "math", "iframe", "object", "embed", "template", "head":
			return
		}
		next := dst
		switch src.Data {
		case "p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "code", "pre", "blockquote":
			next = &html.Node{Type: html.ElementNode, Data: src.Data, DataAtom: src.DataAtom}
			dst.AppendChild(next)
		case "a":
			for _, a := range src.Attr {
				if a.Key == "href" && a.Namespace == "" && approvedReplyLink(a.Val) {
					next = &html.Node{Type: html.ElementNode, Data: "a", DataAtom: atom.A, Attr: []html.Attribute{{Key: "href", Val: a.Val}}}
					dst.AppendChild(next)
					break
				}
			}
		}
		for child := src.FirstChild; child != nil; child = child.NextSibling {
			clean(child, next)
		}
	}
	for _, n := range nodes {
		clean(n, root)
	}
	var out bytes.Buffer
	for n := root.FirstChild; n != nil; n = n.NextSibling {
		_ = html.Render(&out, n)
	}
	return strings.TrimSpace(out.String())
}

func approvedReplyLink(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "myscrollr.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	switch u.EscapedPath() {
	case "", "/", "/account", "/support", "/download", "/uplink", "/uplink/lifetime", "/channels", "/legal":
		return true
	}
	return false
}
