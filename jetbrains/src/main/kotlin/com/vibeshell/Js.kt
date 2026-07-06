package com.vibeshell

/** Encode a string as a JS/JSON string literal (quotes included) for safe
 *  injection into executeJavaScript. */
fun jsStringLiteral(s: String): String {
    val sb = StringBuilder(s.length + 2)
    sb.append('"')
    for (c in s) {
        when {
            c == '\\' -> sb.append("\\\\")
            c == '"' -> sb.append("\\\"")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\t' -> sb.append("\\t")
            // JS line/paragraph separators are valid in JSON strings but break
            // a JS string literal — escape them.
            c.code == 0x2028 -> sb.append("\\u2028")
            c.code == 0x2029 -> sb.append("\\u2029")
            c < ' ' -> sb.append("\\u%04x".format(c.code))
            else -> sb.append(c)
        }
    }
    sb.append('"')
    return sb.toString()
}
