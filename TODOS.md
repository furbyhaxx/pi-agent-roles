# Todos and fixes

- `ask` prompt should give details (e.g. instead of `allow write tool` -> `allow write tmp/test.log`)
- role definitions must be able to completely rescope the skill roots to be able to completely switch the available skills exposed to the agent.
  something like `skills.root_dirs: []` and `skills.root_inherit: bool`.
  Also restructuring the `skill` field on the role definition to something like:
  ```yaml
  skills:
    roots:
      inherit: false # completely empty the skill list
      dirs: [".pi/skillsets/myrole"] # set new skill discovery root
    inherit_loaded: false # if we should keep the currently loaded skills or not
    # specify auto load skills
    required:
      - myskill1
      - myskill2
    # define skills that are mentioned to the user when he switches to that role
    optional:
      - myskill3
      - myskill4
    # explicitely hide specific skills
    # no generic hiding of all skills which is undefined behaviour
    hidden: []
  ```
  this should still support glob patterns of course.
  and maybe we should do something similar to the tools config in the role definition.
      