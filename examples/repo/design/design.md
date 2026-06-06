# Example Design Doc

Comments should be portable by default, readable by any conforming tool.

The protocol follows Delta Lake's model: the markdown is immutable data and
comments are an append-only action log stored beside it.

Every comment is a real commit on the working branch, kept under `.gloss/` so it
stays out of the document's own diff.
