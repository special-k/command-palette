/** @babel */

import SelectListView from 'atom-select-list'
import {humanizeKeystroke} from 'underscore-plus'
import fuzzaldrin from 'fuzzaldrin'
import fuzzaldrinPlus from 'fuzzaldrin-plus'

export default class CommandPaletteView {
  constructor (initiallyVisibleItemCount = 10) {
    const self = this
    this.keyBindingsForActiveElement = []
    this.selectListView = new SelectListView({
      initiallyVisibleItemCount: initiallyVisibleItemCount, // just for being able to disable visible-on-render in spec
      items: [],
      filter: this.filter,
      emptyMessage: 'No matches found',
      elementForItem: (item, {index, selected, visible}) => {
        if (!visible) {
          return document.createElement("li")
        }

        const li = document.createElement('li')
        li.classList.add('event', 'two-lines')
        li.dataset.eventName = item.name

        const rightBlock = document.createElement('div')
        rightBlock.classList.add('pull-right')

        this.keyBindingsForActiveElement
        .filter(({command}) => command === item.name)
        .forEach(keyBinding => {
          const kbd = document.createElement('kbd')
          kbd.classList.add('key-binding')
          kbd.textContent = humanizeKeystroke(keyBinding.keystrokes)
          rightBlock.appendChild(kbd)
        })
        li.appendChild(rightBlock)

        const leftBlock = document.createElement('div')
        const titleEl = document.createElement('div')
        titleEl.classList.add('primary-line')
        titleEl.title = item.name
        leftBlock.appendChild(titleEl)

        const query = this.selectListView.getQuery()
        this.highlightMatchesInElement(item.displayName, query, titleEl)

        if (selected) {
          let secondaryEl = document.createElement('div')
          secondaryEl.classList.add('secondary-line')
          secondaryEl.style.display = 'flex'

          if (typeof item.description === 'string') {
            secondaryEl.appendChild(this.createDescription(item.description, query))
          }

          if (Array.isArray(item.tags)) {
            const matchingTags = item.tags
              .map(t => [t, this.fuzz.score(t, query)])
              .filter(([t, s]) => s > 0)
              .sort((a, b) => a.s - b.s)
              .map(([t, s]) => t)

            if (matchingTags.length > 0) {
              secondaryEl.appendChild(this.createTags(matchingTags, query))
            }
          }

          leftBlock.appendChild(secondaryEl)
        }

        li.appendChild(leftBlock)
        return li
      },
      didConfirmSelection: (keyBinding) => {
        this.hide()
        const event = new CustomEvent(keyBinding.name, {bubbles: true, cancelable: true})
        this.activeElement.dispatchEvent(event)
      },
      didCancelSelection: () => {
        this.hide()
      }
    })
    this.selectListView.element.classList.add('command-palette')
    atom.views.getView(this.selectListView.refs.queryEditor).addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && self.selectListView.refs.queryEditor.getText() === self.defaultCommandPath) {
        this.selectListView.reset()
      }
    })
  }

  async destroy () {
    await this.selectListView.destroy()
  }

  toggle () {
    if (this.panel && this.panel.isVisible()) {
      this.hide()
      return Promise.resolve()
    } else {
      return this.show()
    }
  }

  async show (showHiddenCommands = false, showPrefix = false) {
    if (!this.panel) {
      this.panel = atom.workspace.addModalPanel({item: this.selectListView})
    }

    if (!this.preserveLastSearch) {
      this.selectListView.reset()
      if (this.defaultCommandPath && showPrefix) this.selectListView.refs.queryEditor.setText(this.defaultCommandPath)
    } else {
      this.selectListView.refs.queryEditor.selectAll()
      if (this.defaultCommandPath && showPrefix) this.selectListView.refs.queryEditor.setText(this.defaultCommandPath)
    }

    this.activeElement = (document.activeElement === document.body) ? atom.views.getView(atom.workspace) : document.activeElement
    this.keyBindingsForActiveElement = atom.keymaps.findKeyBindings({target: this.activeElement})
    const commandsForActiveElement = atom.commands
        .findCommands({target: this.activeElement})
        .filter(command => showHiddenCommands === !!command.hiddenInCommandPalette)
    commandsForActiveElement.sort((a, b) => a.displayName.localeCompare(b.displayName))
    await this.selectListView.update({items: commandsForActiveElement})

    this.previouslyFocusedElement = document.activeElement
    this.panel.show()
    this.selectListView.focus()
  }

  hide () {
    this.panel.hide()
    if (this.previouslyFocusedElement) {
      this.previouslyFocusedElement.focus()
      this.previouslyFocusedElement = null
    }
  }

  async update (props) {
    if (props.hasOwnProperty('preserveLastSearch')) {
      this.preserveLastSearch = props.preserveLastSearch
    }

    if (props.hasOwnProperty('useAlternateScoring')) {
      this.useAlternateScoring = props.useAlternateScoring
    }

    if (props.hasOwnProperty('defaultCommandPath')) {
      this.defaultCommandPath = props.defaultCommandPath
    }
  }

  get fuzz () {
    return this.useAlternateScoring ? fuzzaldrinPlus : fuzzaldrin
  }

  highlightMatchesInElement (text, query, el) {
    const matches = this.fuzz.match(text, query)
    let matchedChars = []
    let lastIndex = 0
    for (const matchIndex of matches) {
      const unmatched = text.substring(lastIndex, matchIndex)
      if (unmatched) {
        if (matchedChars.length > 0) {
          const matchSpan = document.createElement('span')
          matchSpan.classList.add('character-match')
          matchSpan.textContent = matchedChars.join('')
          el.appendChild(matchSpan)
          matchedChars = []
        }

        el.appendChild(document.createTextNode(unmatched))
      }

      matchedChars.push(text[matchIndex])
      lastIndex = matchIndex + 1
    }

    if (matchedChars.length > 0) {
      const matchSpan = document.createElement('span')
      matchSpan.classList.add('character-match')
      matchSpan.textContent = matchedChars.join('')
      el.appendChild(matchSpan)
    }

    const unmatched = text.substring(lastIndex)
    if (unmatched) {
      el.appendChild(document.createTextNode(unmatched))
    }
  }

  filter = (items, query) => {
    if (query.length === 0) {
      return items
    }

    const scoredItems = []
    for (const item of items) {
      let score = this.fuzz.score(item.displayName, query)
      if (item.tags) {
        score += item.tags.reduce(
          (currentScore, tag) => currentScore + this.fuzz.score(tag, query),
          0
        )
      }
      if (item.description) {
        score += this.fuzz.score(item.description, query)
      }

      if (score > 0) {
        scoredItems.push({item, score})
      }
    }
    scoredItems.sort((a, b) => b.score - a.score)
    return scoredItems.map((i) => i.item)
  }

  createDescription (description, query) {
    const descriptionEl = document.createElement('div')

    // in case of overflow, give full contents on long hover
    descriptionEl.title = description

    Object.assign(descriptionEl.style, {
      flexGrow: 1,
      flexShrink: 1,
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      overflow: 'hidden'
    })
    this.highlightMatchesInElement(description, query, descriptionEl)
    return descriptionEl
  }

  createTag (tagText, query) {
    const tagEl = document.createElement('li')
    Object.assign(tagEl.style, {
      borderBottom: 0,
      display: 'inline',
      padding: 0
    })
    this.highlightMatchesInElement(tagText, query, tagEl)
    return tagEl
  }

  createTags (matchingTags, query) {
    const tagsEl = document.createElement('ol')
    Object.assign(tagsEl.style, {
      display: 'inline',
      marginLeft: '4px',
      flexShrink: 0,
      padding: 0
    })

    const introEl = document.createElement('strong')
    introEl.textContent = 'matching tags: '

    tagsEl.appendChild(introEl)
    matchingTags.map(t => this.createTag(t, query)).forEach((tagEl, i) => {
      tagsEl.appendChild(tagEl)
      if (i < matchingTags.length - 1) {
        const commaSpace = document.createElement('span')
        commaSpace.textContent = ', '
        tagsEl.appendChild(commaSpace)
      }
    })
    return tagsEl
  }
}
