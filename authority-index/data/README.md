# Source dumps

Put the downloaded dumps of the authority files here, with these names:

```
ns_skos.ttl
authorities-gnd-sachbegriff_lds.ttl.gz
mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz
mapping-authorities-gnd-nsogg_lds.jsonld.gz
databnf_rameau_nt.tar.gz
subjects.skosrdf.ttl
materia-MARCXML.xml
generoforma-MARCXML.xml
```

Where to download each one: `REBUILD.md`, section 2. The dumps are not part
of the repository (they weigh several GB and have their own licences, see
`DATA_LICENSES.md`); Git ignores everything in this folder except this file.

Then, from the repository root:

```
python authority-index/build_index.py --check
python authority-index/build_index.py
```
