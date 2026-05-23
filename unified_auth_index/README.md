### Data sources:

The `unified_index_core.json` is built using available data (not provided) from NS, LCSH, BNE, GND IdRef/RAMEAU.
Data used can be found at:
- lcsh [https://id.loc.gov/download/authorities/subjects.skosrdf.ttl.gz](https://id.loc.gov/download/authorities/subjects.skosrdf.ttl.gz) [uncompressed],
- bne  [https://datos.bne.es/datadumps/materias.nt.bz2](https://datos.bne.es/datadumps/materias.nt.bz2) [uncompressed],
- gnd  [https://data.dnb.de/opendata/authorities-gnd-sachbegriff_lds.ttl.gz](https://data.dnb.de/opendata/authorities-gnd-sachbegriff_lds.ttl.gz) [compressed],
- bnf  [https://transfert.bnf.fr/link/7da54f6e-34e0-48c5-b7c3-f3912cdcf355](https://transfert.bnf.fr/link/7da54f6e-34e0-48c5-b7c3-f3912cdcf355) [compressed],  
- ns   [https://digitale.bncf.firenze.sbn.it/openrdf-workbench/repositories/NS/export?Accept=text%2Fturtle&limit=All](https://digitale.bncf.firenze.sbn.it/openrdf-workbench/repositories/NS/export?Accept=text%2Fturtle&limit=All) [uncompressed],
- gnd mapping lcsh/rameau [https://data.dnb.de/opendata/mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz](https://data.dnb.de/opendata/mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz) [compressed],
- gnd mapping ns [https://data.dnb.de/opendata/mapping-authorities-gnd-nsogg_lds.jsonld.gz](https://data.dnb.de/opendata/mapping-authorities-gnd-nsogg_lds.jsonld.gz) [compressed]

These files should be put in the `data` folder, and the name correspondence checked, before running the `build_index.py` script.
