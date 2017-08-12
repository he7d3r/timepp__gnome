const St             = imports.gi.St;
const Gio            = imports.gi.Gio
const Gtk            = imports.gi.Gtk;
const Meta           = imports.gi.Meta;
const GLib           = imports.gi.GLib;
const Shell          = imports.gi.Shell;
const Pango          = imports.gi.Pango;
const Clutter        = imports.gi.Clutter;
const DND            = imports.ui.dnd;
const Main           = imports.ui.main;
const CheckBox       = imports.ui.checkBox;
const PopupMenu      = imports.ui.popupMenu;
const MessageTray    = imports.ui.messageTray;
const Util           = imports.misc.util;
const Lang           = imports.lang;
const Signals        = imports.signals;
const Mainloop       = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;


const ME = ExtensionUtils.getCurrentExtension();


const Gettext  = imports.gettext.domain(ME.metadata['gettext-domain']);
const _        = Gettext.gettext;
const ngettext = Gettext.ngettext;


const SIG_MANAGER    = ME.imports.lib.signal_manager;
const KEY_MANAGER    = ME.imports.lib.keybinding_manager;
const FUZZ           = ME.imports.lib.fuzzy_search;
const NUM_PICKER     = ME.imports.lib.num_picker;
const PANEL_ITEM     = ME.imports.lib.panel_item;
const MULTIL_ENTRY   = ME.imports.lib.multiline_entry;
const SCROLL_TO_ITEM = ME.imports.lib.scroll_to_item;


const CACHE_FILE = GLib.get_home_dir() +
                   '/.cache/timepp_gnome_shell_extension/timepp_todo.json';


const TIME_TRACKER_DBUS_IFACE =
    '<node>                                                 \
        <interface name="timepp.zagortenay333.TimeTracker"> \
            <method name="stop_all_tracking">               \
            </method>                                       \
                                                            \
            <method name="stop_tracking_by_id">             \
                <arg type="s" direction="in"/>              \
            </method>                                       \
                                                            \
            <method name="start_tracking_by_id">            \
                <arg type="s" direction="in"/>              \
            </method>                                       \
        </interface>                                        \
    </node>';


const SortOrder = {
    ASCENDING  : 'ASCENDING',
    DESCENDING : 'DESCENDING',
};


const SortType = {
    CONTEXT         : 'CONTEXT',
    PROJECT         : 'PROJECT',
    PRIORITY        : 'PRIORITY',
    DUE_DATE        : 'DUE_DATE',
    COMPLETED       : 'COMPLETED',
    CREATION_DATE   : 'CREATION_DATE',
    COMPLETION_DATE : 'COMPLETION_DATE',
};


const View = {
    CLEAR         : 'CLEAR',
    STATS         : 'STATS',
    SEARCH        : 'SEARCH',
    EDITOR        : 'EDITOR',
    DEFAULT       : 'DEFAULT',
    LOADING       : 'LOADING',
    SELECT_SORT   : 'SELECT_SORT',
    FILE_SWITCH   : 'FILE_SWITCH',
    NO_TODO_FILE  : 'NO_TODO_FILE',
    SELECT_FILTER : 'SELECT_FILTER',
};


const REG_CONTEXT        = /^@.+$/;
const REG_PROJ           = /^\+.+$/;
const REG_PRIO           = /^\([A-Z]\)$/;
const REG_DATE           = /^\d{4}-\d{2}-\d{2}$/;
const REG_EXT            = /^[^:]+:[^:]+$/;
const REG_FILE_PATH      = /^~?\//;
const REG_PRIO_EXT       = /^(?:pri|PRI):[A-Z]$/;
const REG_HIDE_EXT       = /^h:1$/;
const REG_TRACKER_ID_EXT = /^tracker_id:[^:]+$/;
const REG_REC_EXT_1      = /^rec:[1-9][0-9]*[dw]$/;
const REG_REC_EXT_2      = /^rec:x-[1-9][0-9]*[dw]$/;
const REG_REC_EXT_3      = /^rec:[1-9][0-9]*d-[1-9][0-9]*m$/;
const REG_DUE_EXT        = /^(?:due|DUE):\d{4}-\d{2}-\d{2}$/;
const REG_URL            = /^\b((?:https?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?]))$/;


// return date string in yyyy-mm-dd format adhering to locale
function date_yyyymmdd (date_obj) {
    let now = date_obj || new Date();

    let month = now.getMonth() + 1;
    let day   = now.getDate();

    month = (month < 10) ? ('-' + 0 + month) : ('-' + month);
    day   = (day   < 10) ? ('-' + 0 + day)   : ('-' + day);

    return now.getFullYear() + month + day;
}


// This function splits the @str into words at spaces and returns array of
// those words.
// Escaped spaces ('\ ') are included in their respective words as well as the
// backslash. E.g., ['as\ df', 'qwert\ y', ...].
function split_on_spaces (str) {
    let words = [];
    let i, word;

    if (str.startsWith('\\ ')) {
        i    = 2;
        word = ' ';
    }
    else {
        i    = 1;
        word = (str[0] === ' ') ? '' : str[0];
    }

    for (let len = str.length; i < len; i++) {
        if (str[i] === ' ') {
            if (str[i - 1] === '\\') {
                word += ' ';
            }
            else if (word) {
                words.push(word);
                word = '';
            }
        }
        else {
            word += str[i];
        }
    }

    if (word) words.push(word);

    return words;
}


// @BUG
// There is an issue with resizing when using pango's wrap mode together with a
// scrollview. The label does not seem to get resized properly and as a result
// to container doesn't either, which leads various issues.
//
// The needs_scrollbar func will not return a correct value because of this.
// Also, sometimes the bottom actor might be cut off, or extra padding might be
// added...
//
// The issue does not appear if the scrollbar is visible, so it doesn't need to
// be used all the time and is not a performance issue.
//
// This func needs to be used at a time when the actor is already drawn, or it
// will not work.
function resize_label (label) {
    let theme_node = label.get_theme_node();
    let alloc_box  = label.get_allocation_box();

    // gets the acutal width of the box
    let width = alloc_box.x2 - alloc_box.x1;

    // remove paddings and borders
    width = theme_node.adjust_for_width(width);

    // nat_height is the minimum height needed to fit the multiline text
    // **excluding** the vertical paddings/borders.
    let [min_height, nat_height] = label.clutter_text.get_preferred_height(width);

    // The vertical padding can only be calculated once the box is painted.
    // nat_height_adjusted is the minimum height needed to fit the multiline
    // text **including** vertical padding/borders.
    let [min_height_adjusted, nat_height_adjusted] =
        theme_node.adjust_preferred_height(min_height, nat_height);
    let vert_padding = nat_height_adjusted - nat_height;

    label.set_height(nat_height + vert_padding);
}


// =====================================================================
// @@@ Main
//
// @ext      : obj (main extension object)
// @settings : obj (extension settings)
// =====================================================================
const Todo = new Lang.Class({
    Name: 'Timepp.Todo',

    _init: function (ext, settings) {
        this.ext      = ext;
        this.settings = settings;


        this.section_enabled = this.settings.get_boolean('todo-enabled');
        this.separate_menu   = this.settings.get_boolean('todo-separate-menu');
        this.cache_file      = null;
        this.cache           = null;

        this.sigm         = new SIG_MANAGER.SignalManager();
        this.keym         = new KEY_MANAGER.KeybindingManager(this.settings);
        this.view_manager = null;
        this.time_tracker = null;


        // Track how many tasks have a particular proj/context/prio, a
        // recurrence, etc...
        this.stats = null;
        this._reset_stats_obj();


        // A GFile to the todo.txt file, GMonitor.
        this.todo_txt_file     = null;
        this.todo_file_monitor = null;


        // @NOTE
        //
        // this.tasks, this.tasks_viewport and the popup menu are the
        // only places where refs to task objects can be held for longer periods
        // of time.
        // If a task has been permanently removed from this.tasks, then it has
        // to be also removed from this.tasks_viewport and the popup_menu.
        // Removing a task object from all 3 of those is expected to delete that
        // object.
        //
        // - To ADD a task, create the object and add it to this.tasks and call
        //   this.on_tasks_changed() soon after that.
        //   When creating a large number of tasks all at once, it's best to use
        //   the async func this.create_tasks().
        //
        // - To DELETE a task, remove the object from this.tasks and call
        //   on_tasks_changed() soon after that.
        //
        // - To EDIT a task, create a new task_str and call the task objects'
        //   reset method with the new string, and call on_tasks_changed()
        //   soon after that.
        //
        // Note that on_tasks_changed() does not update the todo.txt file. Use
        // write_tasks_to_file() for that.


        // All task objects.
        this.tasks = [];


        // Array of all tasks that have been filtered. Only tasks in this array
        // can be added to the popup menu.
        this.tasks_viewport = [];


        // @SPEED
        // This is used by the _do_search func to store search queries and their
        // results for the duration of the search.
        //
        // @key : string (a search query)
        // @val : array  (of tasks that match the search query)
        this.search_dictionary = new Map();


        // The last string that was searched for.
        this.last_search_pattern = '';


        // @SPEED
        // Mainloop source id's of the corresponding async funcs.
        // If null, the corresponding func is not running.
        this.create_tasks_mainloop_id      = null;
        this.add_tasks_to_menu_mainloop_id = null;


        // The mainloop id of the _on_day_started_loop.
        // If null, the loop is not running.
        this.on_day_started_loop_id = null;


        // The custom css properties 'context-color', 'project-color', and
        // 'link-color' can be used in the themes css file to style the task
        // markup.
        //
        // These css properties need to be added to the
        // 'timepp-menu todo-section' selector.
        //
        // The colors are parsed and stored in this object.
        this.markup_colors = {
            project : 'magenta',
            context : 'green',
            link    : 'blue',
        };


        // @SPEED
        // Tweak this function to completely disable animations when closing
        // the popup menu in order to avoid lag when there are lots of items.
        this.ext.menu.close = function () {
            if (this._boxPointer.actor.visible) {
                this._boxPointer.hide(false, Lang.bind(this, function() {
                    this.emit('menu-closed');
                }));
            }
            if (!this.isOpen) return;
            this.isOpen = false;
            this.emit('open-state-changed', false);
        };


        //
        // register shortcuts (need to be enabled later on)
        //
        this.keym.register('todo-keybinding-open', () => {
            this.ext.open_menu(this);
            if (this.view_manager.current_view !== View.LOADING &&
                this.view_manager.current_view !== View.NO_TODO_FILE) {

                this.show_view__default();
            }
        });
        this.keym.register('todo-keybinding-open-to-add', () => {
            this.ext.open_menu(this);
            if (this.view_manager.current_view !== View.LOADING &&
                this.view_manager.current_view !== View.NO_TODO_FILE) {

                this.show_view__task_editor();
            }
        });
        this.keym.register('todo-keybinding-open-to-search', () => {
            this.ext.open_menu(this);
            if (this.view_manager.current_view !== View.LOADING &&
                this.view_manager.current_view !== View.NO_TODO_FILE) {

                this.show_view__search();
            }
        });
        this.keym.register('todo-keybinding-open-to-switch-files', () => {
            this.ext.open_menu(this);
            if (this.view_manager.current_view !== View.LOADING &&
                this.view_manager.current_view !== View.NO_TODO_FILE &&
                this.settings.get_value('todo-files').deep_unpack().length > 1) {

                this.show_view__file_switcher();
            }
        });


        //
        // panel item
        //
        this.panel_item = new PANEL_ITEM.PanelItem(ext.menu);

        this.panel_item.actor.add_style_class_name('todo-panel-item');
        this.panel_item.icon.icon_name = 'timepp-todo-symbolic';
        this._toggle_panel_item_mode();

        ext.panel_item_box.add_actor(this.panel_item.actor);


        //
        // todo section
        //
        this.actor = new St.BoxLayout({ vertical: true, style_class: 'section todo-section' });


        //
        // search entry bin
        //
        this.search_entry_bin = new PopupMenu.PopupMenuItem('', { hover: false, activate: false });
        this.actor.add_actor(this.search_entry_bin.actor);
        this.search_entry_bin.label.hide();
        this.search_entry_bin.actor.hide();

        this.search_entry = new St.Entry({ can_focus: true });
        this.search_entry_bin.actor.add(this.search_entry, {expand: true});

        this.close_icon = new St.Icon({ icon_name: 'timepp-close-symbolic' });
        this.search_entry.set_secondary_icon(this.close_icon);


        //
        // loading message
        //
        this.loading_msg = new PopupMenu.PopupMenuItem(_('Loading...'), { hover: false, activate: false, style_class: 'loading-msg' });
        this.actor.add_actor(this.loading_msg.actor);
        this.loading_msg.actor.hide();
        this.loading_msg.label.can_focus = true;
        this.loading_msg.actor.can_focus = false;


        //
        // no todo file message
        //
        this.no_todo_file_msg = new PopupMenu.PopupMenuItem(_('Select todo file in settings...'), { hover: false, activate: false, style_class: 'no-todo-file-msg' });
        this.actor.add_actor(this.no_todo_file_msg.actor);
        this.no_todo_file_msg.actor.hide();
        this.no_todo_file_msg.label.can_focus = true;
        this.no_todo_file_msg.actor.can_focus = false;


        //
        // header
        //
        this.header = new PopupMenu.PopupMenuItem('', { hover: false, activate: false, style_class: 'header' });
        this.actor.add_actor(this.header.actor);
        this.header.label.hide();
        this.header.actor.hide();
        this.header.actor.can_focus = false;

        this.add_task_button = new St.Button({ can_focus: true, x_align: St.Align.START, style_class: 'add-task' });
        this.header.actor.add(this.add_task_button, { expand: true });

        this.add_task_bin = new St.BoxLayout();
        this.add_task_button.add_actor(this.add_task_bin);

        this.add_task_icon = new St.Icon({ icon_name: 'timepp-plus-symbolic', y_align: Clutter.ActorAlign.CENTER });
        this.add_task_bin.add_actor(this.add_task_icon);

        this.add_task_label = new St.Label({ text: _('Add New Task...'), y_align: Clutter.ActorAlign.CENTER });
        this.add_task_bin.add_actor(this.add_task_label);


        // icon bin
        this.icon_box = new St.BoxLayout({ x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
        this.header.actor.add(this.icon_box);


        // filter icon
        this.filter_button = new St.Button({ can_focus: true, x_align: St.Align.END, style_class: 'filter-icon' });
        this.icon_box.add(this.filter_button);

        this.filter_icon = new St.Icon({ icon_name: 'timepp-filter-symbolic', y_align: Clutter.ActorAlign.CENTER });
        this.filter_button.add_actor(this.filter_icon);


        // sort icon
        this.sort_button = new St.Button({ can_focus: true, x_align: St.Align.END, style_class: 'sort-icon' });
        this.icon_box.add(this.sort_button);

        this.sort_icon = new St.Icon({ y_align: Clutter.ActorAlign.CENTER });
        this.sort_button.add_actor(this.sort_icon);


        // todo file switcher icon
        this.file_switcher_button = new St.Button({ can_focus: true, x_align: St.Align.END, style_class: 'file-switcher-icon' });
        this.icon_box.add(this.file_switcher_button);

        this.file_switcher_icon = new St.Icon({ icon_name: 'timepp-file-switch-symbolic', y_align: Clutter.ActorAlign.CENTER });
        this.file_switcher_button.add_actor(this.file_switcher_icon);

        if (this.settings.get_value('todo-files').deep_unpack().length > 1)
            this.file_switcher_button.show();
        else
            this.file_switcher_button.hide();


        // search icon
        this.search_button = new St.Button({ can_focus: true, x_align: St.Align.END, style_class: 'search-icon' });
        this.icon_box.add(this.search_button);

        this.search_icon = new St.Icon({ icon_name: 'timepp-search-symbolic', y_align: Clutter.ActorAlign.CENTER });
        this.search_button.add_actor(this.search_icon);


        // stats icon
        this.stats_button = new St.Button({ can_focus: true, x_align: St.Align.END, style_class: 'stats-icon' });
        this.icon_box.add(this.stats_button);

        this.stats_icon = new St.Icon({ icon_name: 'timepp-graph-symbolic', y_align: Clutter.ActorAlign.CENTER });
        this.stats_button.add_actor(this.stats_icon);


        // clear icon
        this.clear_button = new St.Button({ visible: false, can_focus: true, x_align: St.Align.END, style_class: 'clear-icon' });
        this.icon_box.add(this.clear_button);

        this.clear_icon = new St.Icon({ icon_name: 'timepp-clear-symbolic', y_align: Clutter.ActorAlign.CENTER });
        this.clear_button.add_actor(this.clear_icon);


        //
        // task items box
        //
        this.tasks_scroll_wrapper = new St.BoxLayout({ style_class: 'popup-menu-item' });
        this.actor.add(this.tasks_scroll_wrapper, {expand: true});

        // @HACK
        // Using the PopupMenuItem as a wrapper won't work here if there is
        // a large num of tasks. Various event listeners in PopupMenuItem
        // will cause major lag when entering the wrapper with the mouse.
        // We replicate the PopupMenuItem by adding an ornament to ensure
        // proper horizontal padding.
        let ornament = new St.Label({style_class: 'popup-menu-ornament' });
        this.tasks_scroll_wrapper.add_actor(ornament);

        this.tasks_scroll = new St.ScrollView({ style_class: 'tasks-container vfade', x_fill: true, y_align: St.Align.START});
        this.tasks_scroll_wrapper.add(this.tasks_scroll, {expand: true});

        this.tasks_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.tasks_scroll_content = new St.BoxLayout({ vertical: true, style_class: 'tasks-content-box'});
        this.tasks_scroll.add_actor(this.tasks_scroll_content);


        //
        // listen
        //
        this.sigm.connect(this.settings, 'changed::todo-files', () => {
            let todo_files = this.settings.get_value('todo-files').deep_unpack();
            if (todo_files.length > 1) this.file_switcher_button.show();
            else                       this.file_switcher_button.hide();
        });
        this.sigm.connect(this.settings, 'changed::todo-separate-menu', () => {
            this.separate_menu = this.settings.get_boolean('todo-separate-menu');
            this.ext.update_panel_items();
        });
        this.sigm.connect(this.settings, 'changed::todo-show-seconds', () => {
            this._update_time_display();
        });
        this.sigm.connect(this.settings, 'changed::todo-panel-mode', () => {
            this._toggle_panel_item_mode();
        });
        this.sigm.connect(this.settings, 'changed::todo-task-width', () => {
            let width = this.settings.get_int('todo-task-width');
            for (let i = 0, len = this.tasks.length; i < len; i++)
                this.tasks[i].actor.width = width;
        });
        this.sigm.connect(this.settings, 'changed::todo-current', () => {
            this._on_todo_file_changed();
        });
        this.sigm.connect(this.panel_item.actor, 'key-focus-in', () => {
            // user has right-clicked to show the context menu
            if (this.ext.menu.isOpen && this.ext.context_menu.actor.visible)
                return;

            this.ext.open_menu(this);
        });
        this.sigm.connect(this.panel_item, 'left-click', () => { this.ext.toggle_menu(this); });
        this.sigm.connect(this.panel_item, 'right-click', () => { this.ext.toggle_context_menu(this); });
        this.sigm.connect(this.add_task_button, 'clicked', () => { this.show_view__task_editor(); });
        this.sigm.connect(this.filter_button, 'clicked', () => { this.show_view__filters(); });
        this.sigm.connect(this.sort_button, 'clicked', () => { this.show_view__sort(); });
        this.sigm.connect(this.file_switcher_button, 'clicked', () => { this.show_view__file_switcher(); });
        this.sigm.connect(this.search_button, 'clicked', () => { this.show_view__search(); });
        this.sigm.connect(this.stats_button, 'clicked', () => { this.show_view__time_tracker_stats(); });
        this.sigm.connect(this.clear_button, 'clicked', () => { this.show_view__clear_completed(); });
        this.sigm.connect(this.search_entry, 'secondary-icon-clicked', () => { this.show_view__default(); });
        this.sigm.connect(this.actor, 'style-changed', () => { this._update_markup_colors(); });
        this.sigm.connect(this.search_entry.clutter_text, 'text-changed', () => {
            Mainloop.idle_add(() => this._search());
        });


        if (this.section_enabled) this.enable_section();
        else                      this.sigm.disconnect_all();
    },

    on_section_open_state_changed: function (state) {
        if (state) {
            this.panel_item.actor.add_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = false;
        }
        else {
            this.panel_item.actor.remove_style_pseudo_class('checked');
            this.panel_item.actor.can_focus = true;
        }

        this.emit('section-open-state-changed', state);
    },

    toggle_section: function () {
        if (this.section_enabled) {
            this.disable_section();
        }
        else {
            this.sigm.connect_all();
            this.enable_section();
        }

        this.section_enabled = this.settings.get_boolean('todo-enabled');
        this.ext.update_panel_items();
    },

    enable_section: function () {
        // init cache file
        try {
            this.cache_file = Gio.file_new_for_path(CACHE_FILE);

            let cache_format_version =
                ME.metadata['cache-file-format-version'].todo;

            if (this.cache_file.query_exists(null)) {
                let [, contents] = this.cache_file.load_contents(null);
                this.cache = JSON.parse(contents);
            }

            if (!this.cache || !this.cache.format_version ||
                this.cache.format_version !== cache_format_version) {

                this.cache = {
                    format_version: cache_format_version,

                    sort: [
                        [SortType.COMPLETED       , SortOrder.ASCENDING],
                        [SortType.PRIORITY        , SortOrder.ASCENDING],
                        [SortType.DUE_DATE        , SortOrder.ASCENDING],
                        [SortType.CONTEXT         , SortOrder.ASCENDING],
                        [SortType.PROJECT         , SortOrder.ASCENDING],
                        [SortType.CREATION_DATE   , SortOrder.ASCENDING],
                        [SortType.COMPLETION_DATE , SortOrder.ASCENDING],
                    ],

                    filters: {
                        invert_filters : false,
                        recurring      : false,
                        hidden         : false,
                        completed      : false,
                        no_priority    : false,
                        priorities     : [],
                        contexts       : [],
                        projects       : [],
                        custom         : [],
                        custom_active  : [],
                    },
                };
            }
        }
        catch (e) {
            logError(e);
            return;
        }

        this.view_manager = new ViewManager(this.ext, this);
        this.time_tracker = new TimeTracker(this.ext, this);

        this._init_todo_file();
        this.keym.enable_all();
        this._on_day_started_loop();
    },

    disable_section: function () {
        this.sigm.disconnect_all();
        this.keym.disable_all();
        this.tasks          = [];
        this.tasks_viewport = [];
        this.tasks_scroll_content.remove_all_children();

        if (this.todo_file_monitor) {
            this.todo_file_monitor.cancel();
            this.todo_file_monitor = null;
        }

        if (this.create_tasks_mainloop_id) {
            Mainloop.source_remove(this.create_tasks_mainloop_id);
            this.create_tasks_mainloop_id = null;
        }

        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        if (this.on_day_started_loop_id) {
            Mainloop.source_remove(this.on_day_started_loop_id);
            this.on_day_started_loop_id = null;
        }

        if (this.time_tracker) {
            this.time_tracker.close();
            this.time_tracker = null;
        }

        if (this.view_manager) {
            this.view_manager = null;
        }
    },

    _init_todo_file: function () {
        // reset
        this.tasks          = [];
        this.tasks_viewport = [];
        this.tasks_scroll_content.remove_all_children();
        this.stats.priorities.clear();
        this.stats.contexts.clear();
        this.stats.projects.clear();
        if (this.todo_file_monitor) {
            this.todo_file_monitor.cancel();
            this.todo_file_monitor = null;
        }


        let current = this.settings.get_value('todo-current').deep_unpack();

        if (! current.todo_file) {
            this.show_view__no_todo_file();
            return;
        }

        try {
            this.todo_txt_file = Gio.file_new_for_uri(current.todo_file);

            if (this.todo_file_monitor)
                this.todo_file_monitor.cancel();

            this.todo_file_monitor =
                this.todo_txt_file.monitor_file(Gio.FileMonitorFlags.NONE, null);

            this.todo_file_monitor.connect(
                'changed', Lang.bind(this, this._on_todo_file_changed));

            if (!this.todo_txt_file || !this.todo_txt_file.query_exists(null)) {
                this.show_view__no_todo_file();
                return;
            }
        }
        catch (e) {
            logError(e);
            return;
        }

        this.show_view__loading();

        let [, lines] = this.todo_txt_file.load_contents(null);
        lines = String(lines).split(/\n|\r/);

        this.create_tasks(lines, () => {
            this._check_recurrences();
            this.on_tasks_changed();
            this.show_view__default();
        });
    },

    store_cache: function () {
        if (!this.cache_file || !this.cache_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.cache_file.replace_contents(JSON.stringify(this.cache, null, 2),
            null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    write_tasks_to_file: function () {
        this.file_monitor_handler_block = true;

        let res = '';

        let len = this.tasks.length;
        for (let i = 0; i < len; i++) res += this.tasks[i].task_str + '\n';

        if (!this.todo_txt_file || !this.todo_txt_file.query_exists(null))
            this.cache_file.create(Gio.FileCreateFlags.NONE, null);

        this.todo_txt_file.replace_contents(res, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    },

    _on_todo_file_changed: function (a, b, c, event_type) {
        // @HACK
        // The normal handler_block/unblock methods don't work with a file
        // monitor for some reason. This seems to work well enough.
        if (this.file_monitor_handler_block) {
            Mainloop.idle_add(() => {
                this.file_monitor_handler_block = false;
            });
            return;
        }

        if (event_type === Gio.FileMonitorEvent.DELETED ||
            event_type === Gio.FileMonitorEvent.MOVED   ||
            event_type === Gio.FileMonitorEvent.CREATED) {

            this._init_todo_file();
            return;
        }

        if (event_type !== undefined &&
            event_type !== Gio.FileMonitorEvent.CHANGES_DONE_HINT) {

            return;
        }

        this._init_todo_file();
    },

    _on_day_started_loop: function () {
        if (this.on_day_started_loop_id) return;

        let t = new Date();
        t = 86400 - Math.round((t.getTime() - t.setHours(0,0,2,0)) / 1000);

        this.on_day_started_loop_id = Mainloop.timeout_add_seconds(t, () => {
            // We only emit here, or else we will emit every time the ext
            // gets reloaded. In that case it couldn't be used by functions
            // that deal with persistent data. On the other hand, this may never
            // execute if the ext is removed before midnight and added back
            // after.
            this.emit('new-day');

            // Update all due dates.
            for (let i = 0, len = this.tasks.length; i < len; i++) {
                this.tasks[i].update_due_date();
            }

            this._check_recurrences();

            this.on_day_started_loop_id = null;
            this._on_day_started_loop();
        });
    },

    _check_recurrences: function () {
        let needs_update = false;
        let n            = 0;

        for (let i = 0, len = this.tasks.length; i < len; i++) {
            if (this.tasks[i].check_recurrence()) {
                needs_update = true;
                n++;
            }
        }

        if (needs_update) {
            Main.notify(ngettext('%d task has recurred',
                                 '%d tasks have recurred',
                                  n).format(n));

            this.write_tasks_to_file();
            this.on_tasks_changed();
        }
    },

    _update_markup_colors: function () {
        let update_needed = false;

        ['context', 'project', 'link'].forEach((it) => {
            let [success, col] = this.actor.get_theme_node()
                                 .lookup_color(it + '-color', false);

            if (! success) return;

            col = col.to_string().substr(0, 7);

            if (this.markup_colors[it] !== col) {
                this.markup_colors[it] = col;
                update_needed = true;
            }
        });

        if (update_needed) {
            for (let i = 0, len = this.tasks.length; i < len; i++) {
                this.tasks[i].update_markup_colors();
            }
        }
    },

    // The form of the stats object is only defined here.
    //
    // The maps have the structure:
    // @key : string  (a context/project/priority)
    // @val : natural (number of tasks that have that @key)
    _reset_stats_obj: function () {
        this.stats = {
            recurring_completed   : 0,
            recurring_incompleted : 0,
            hidden                : 0,
            completed             : 0,
            no_priority           : 0,
            priorities            : new Map(),
            contexts              : new Map(),
            projects              : new Map(),
        };
    },

    _toggle_panel_item_mode: function () {
        if (this.settings.get_enum('todo-panel-mode') === 0)
            this.panel_item.set_mode('icon');
        else if (this.settings.get_enum('todo-panel-mode') === 1)
            this.panel_item.set_mode('text');
        else
            this.panel_item.set_mode('icon_text');
    },

    show_view__no_todo_file: function () {
        this.panel_item.set_mode('icon');
        this.panel_item.actor.remove_style_class_name('done');

        this.view_manager.show_view({
            view_name      : View.NO_TODO_FILE,
            actors         : [this.no_todo_file_msg.actor],
            focused_actor  : this.no_todo_file_msg.label,
            close_callback : () => { this.no_todo_file_msg.actor.hide(); },
        });
    },

    show_view__loading: function () {
        this.panel_item.set_mode('icon');
        this.panel_item.actor.remove_style_class_name('done');
        this.panel_item.icon.icon_name = 'timepp-todo-loading-symbolic';

        this.view_manager.show_view({
            view_name      : View.LOADING,
            actors         : [this.loading_msg.actor],
            focused_actor  : this.loading_msg.label,
            close_callback : () => {
                this.loading_msg.actor.hide();
                this.panel_item.icon.icon_name = 'timepp-todo-symbolic';
                this._toggle_panel_item_mode();
            },
        });
    },

    show_view__default: function () {
        this.view_manager.show_view({
            view_name      : View.DEFAULT,
            actors         : [this.header.actor, this.tasks_scroll_wrapper],
            focused_actor  : this.add_task_button,
            close_callback : () => {
                this.header.actor.hide();
                this.tasks_scroll_wrapper.hide();
            },
        });
    },

    show_view__clear_completed: function () {
        let box = new ClearCompletedTasks(this.ext, this);

        this.view_manager.show_view({
            view_name      : View.CLEAR,
            actors         : [box.actor],
            focused_actor  : box.button_cancel,
            close_callback : () => { box.actor.destroy(); },
        });

        box.connect('delete-all', () => {
            let incompleted_tasks = [];

            for (let i = 0, len = this.tasks.length; i < len; i++) {
                if (!this.tasks[i].completed || this.tasks[i].rec_str)
                    incompleted_tasks.push(this.tasks[i]);
            }

            this.tasks = incompleted_tasks;
            this.on_tasks_changed();
            this.write_tasks_to_file();
            this.show_view__default();
        });

        box.connect('archive-all', () => {
            let completed_tasks   = [];
            let incompleted_tasks = [];

            for (let i = 0, len = this.tasks.length; i < len; i++) {
                if (!this.tasks[i].completed || this.tasks[i].rec_str)
                    incompleted_tasks.push(this.tasks[i]);
                else
                    completed_tasks.push(this.tasks[i]);
            }

            this.archive_tasks(completed_tasks);
            this.tasks = incompleted_tasks;
            this.on_tasks_changed();
            this.write_tasks_to_file();
            this.show_view__default();
        });

        box.connect('cancel', () => {
            this.show_view__default();
        });
    },

    show_view__time_tracker_stats: function (task) {
        let stats;

        if (task) {
            stats = this.time_tracker.get_stats(task.task_str);
            if (stats) stats = [stats];
        }
        else stats = this.time_tracker.get_all_project_stats();

        let stat_view = new TimeTrackerStatView(this.ext, this, stats);

        this.view_manager.show_view({
            view_name      : View.STATS,
            actors         : [stat_view.actor],
            focused_actor  : stat_view.close_button,
            close_callback : () => { stat_view.actor.destroy(); },
        });

        stat_view.connect('close', () => {
            this.show_view__default();
        });
    },

    show_view__search: function () {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        this.view_manager.show_view({
            view_name      : View.SEARCH,
            focused_actor  : this.search_entry,
            actors         : [
                this.search_entry_bin.actor,
                this.tasks_scroll_wrapper
            ],
            close_callback : () => {
                this.search_entry.set_text('');
                this.search_dictionary.clear();
                this.search_entry_bin.actor.hide();
                this.tasks_scroll_wrapper.hide();
                this.add_tasks_to_menu(true);
            },
        });

        // We always search all tasks no matter what filters are active, so
        // add all tasks to the popup menu.
        this.add_tasks_to_menu(true, true);
    },

    show_view__file_switcher: function () {
        let filter_switcher = new TodoFileSwitcher(this.ext, this);

        this.view_manager.show_view({
            view_name      : View.FILE_SWITCH,
            actors         : [filter_switcher.actor],
            focused_actor  : filter_switcher.entry.entry,
            close_callback : () => { filter_switcher.actor.destroy(); },
        });

        filter_switcher.connect('switch', (_, name) => {
            let todo_files = this.settings.get_value('todo-files').deep_unpack();
            let current;

            for (let i = 0, len = todo_files.length; i < len; i++) {
                if (todo_files[i].name === name) {
                    current = todo_files[i];
                    break;
                }
            }

            this.settings.set_value('todo-current',
                                    GLib.Variant.new('a{ss}', current));
        });

        filter_switcher.connect('close', () => {
            this.show_view__default();
        });
    },

    show_view__sort: function () {
        let sort_window = new TaskSortWindow(this.ext, this);

        this.view_manager.show_view({
            view_name      : View.SELECT_SORT,
            actors         : [sort_window.actor],
            focused_actor  : sort_window.button_ok,
            close_callback : () => { sort_window.actor.destroy(); },
        });

        sort_window.connect('update-sort', (_, new_sort_obj) => {
            this.cache.sort = new_sort_obj;
            this.store_cache();
            this.sort_tasks();
            this.show_view__default();
        });
    },

    show_view__filters: function () {
        let filters_window = new TaskFiltersWindow(this.ext, this);

        this.view_manager.show_view({
            view_name      : View.SELECT_FILTER,
            actors         : [filters_window.actor],
            focused_actor  : filters_window.button_ok,
            close_callback : () => { filters_window.actor.destroy(); },
        });

        filters_window.connect('filters-updated', (_, filters) => {
            this.cache.filters = filters;
            this.store_cache();
            this._update_filter_icon();
            this.add_tasks_to_menu(true);
            this.show_view__default();
        });
    },

    show_view__task_editor: function (task) {
        let editor = new TaskEditor(this.ext, this, task);

        this.view_manager.show_view({
            view_name      : View.EDITOR,
            actors         : [editor.actor],
            focused_actor  : editor.entry.entry,
            close_callback : () => { editor.actor.destroy(); },
        });

        if (task) this.time_tracker.stop_tracking(task);

        editor.connect('add-task', (_, task_str) => {
            this.tasks.unshift(new TaskItem(this.ext, this, task_str, true));
            this.on_tasks_changed();
            this.write_tasks_to_file();
            this.show_view__default();
        });

        editor.connect('delete-task', (_, do_archive) => {
            if (do_archive) this.archive_tasks([task]);

            for (let i = 0, len = this.tasks.length; i < len; i++) {
                if (this.tasks[i] === task) {
                    this.tasks.splice(i, 1);
                    break;
                }
            }

            this.on_tasks_changed();
            this.write_tasks_to_file();
            this.show_view__default();
        });

        editor.connect('edit-task', (_, task_str) => {
            task.reset(true, task_str);
            this.on_tasks_changed();
            this.write_tasks_to_file();
            this.show_view__default();
        });

        editor.connect('cancel', () => {
            this.show_view__default();
        });
    },

    // Create task objects from the given task strings and add them to the
    // this.tasks array.
    //
    // Make sure to call this.on_tasks_changed() soon after calling this func.
    //
    // @todo_strings : array (of strings; each string is a line in todo.txt file)
    // @callback     : func
    create_tasks: function (todo_strings, callback) {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        let n = Math.min(todo_strings.length, 21);
        let i = 0;

        for (; i < n; i++) {
            if (/\S/.test(todo_strings[i])) {
                this.tasks.push(new TaskItem(this.ext, this,
                                             todo_strings[i], false));
            }
        }

        this.create_tasks_mainloop_id = Mainloop.idle_add(() => {
            this._create_tasks__finish(i, todo_strings, callback);
        });
    },

    _create_tasks__finish: function (i, todo_strings, callback) {
        if (i === todo_strings.length) {
            if (typeof(callback) === 'function') callback();
            this.create_tasks_mainloop_id = null;
            return;
        }

        if (/\S/.test(todo_strings[i])) {
            this.tasks.push(new TaskItem(this.ext, this, todo_strings[i], false));
        }

        this.create_tasks_mainloop_id = Mainloop.idle_add(() => {
            this._create_tasks__finish(++i, todo_strings, callback);
        });
    },

    // This func must be called soon after 1 or more tasks have been added, or
    // removed from this.tasks array or when they have been edited.
    //
    // This func should not be called many times in a row. The idea is to add,
    // delete, or edit all tasks first and then call this func once.
    //
    // It will handle various things like updating the stats obj, showing or
    // hiding various icons, sorting tasks, etc...
    //
    // This func will not write tasks to the todo.txt file.
    on_tasks_changed: function () {
        //
        // Update stats obj
        //
        {
            this._reset_stats_obj();

            let i, j, n, it, len;

            for (i = 0, len = this.tasks.length; i < len; i++) {
                it = this.tasks[i];

                for (j = 0; j < it.projects.length; j++) {
                    n = this.stats.projects.get(it.projects[j]);
                    this.stats.projects.set(it.projects[j], n ? ++n : 1);
                }

                for (j = 0; j < it.contexts.length; j++) {
                    n = this.stats.contexts.get(it.contexts[j]);
                    this.stats.contexts.set(it.contexts[j], n ? ++n : 1);
                }

                if (it.hidden) {
                    this.stats.hidden++;
                }
                else if (it.completed) {
                    this.stats.completed++;
                }
                else if (it.priority === '(_)') {
                    this.stats.no_priority++;
                }
                else {
                    n = this.stats.priorities.get(it.priority);
                    this.stats.priorities.set(it.priority, n ? ++n : 1);
                }

                if (it.rec_str) {
                    if (it.completed) {
                        this.stats.recurring_completed++;
                        this.stats.completed--;
                    }
                    else {
                        this.stats.recurring_incompleted++;
                    }
                }
            }
        }


        //
        // update panel label
        //
        {
            let n_incompleted = this.tasks.length -
                               this.stats.completed -
                               this.stats.hidden -
                               this.stats.recurring_completed;

            this.panel_item.set_label('' + n_incompleted);

            if (n_incompleted)
                this.panel_item.actor.remove_style_class_name('done');
            else
                this.panel_item.actor.add_style_class_name('done');
        }


        //
        // Since contexts/projects/priorities are filters, it can happen that we
        // have redundant filters in case tasks were deleted. Clean 'em up.
        //
        {
            let i, arr, len;

            arr = this.cache.filters.priorities;
            for (i = 0, len = arr.length; i < len; i++) {
                if (! this.stats.priorities.has(arr[i])) {
                    arr.splice(i, 1);
                    len--; i--;
                }
            }

            arr = this.cache.filters.contexts;
            for (i = 0, len = arr.length; i < len; i++) {
                if (! this.stats.contexts.has(arr[i])) {
                    arr.splice(i, 1);
                    len--; i--;
                }
            }

            arr = this.cache.filters.projects;
            for (i = 0, len = arr.length; i < len; i++) {
                if (! this.stats.projects.has(arr[i])) {
                    arr.splice(i, 1);
                    len--; i--;
                }
            }

            this._update_filter_icon();
        }


        //
        // rest
        //
        this.clear_button.visible = this.stats.completed > 0;
        this.sort_tasks();
    },

    // Add actors of task objects from this.tasks_viewport to the popup menu.
    // Only this function should be used to add task actors to the popup menu.
    //
    // If @update_tasks_viewport is true, then the tasks viewport will be
    // rebuilt (i.e., all tasks will be run through the filter test again.)
    //
    // @update_tasks_viewport : bool
    // @ignore_filters        : bool (only makes sense if @update_tasks_viewport
    //                                is true)
    add_tasks_to_menu: function (update_tasks_viewport, ignore_filters) {
        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        update_tasks_viewport = Boolean(update_tasks_viewport);
        ignore_filters        = Boolean(ignore_filters);

        this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;

        this.tasks_scroll_content.remove_all_children();
        if (update_tasks_viewport) this.tasks_viewport = [];

        let arr = update_tasks_viewport ? this.tasks : this.tasks_viewport;
        let n   = Math.min(arr.length, 21);

        for (let i = 0; i < n; i++) {
            if (update_tasks_viewport) {
                if (ignore_filters || this._filter_test(arr[i])) {
                    this.tasks_viewport.push(arr[i]);
                    this.tasks_scroll_content.add_child(arr[i].actor);
                }
            }
            else this.tasks_scroll_content.add_child(arr[i].actor);

            arr[i].actor.visible = this.ext.menu.isOpen &&
                                   this.tasks_scroll_wrapper.visible;
        }

        this.add_tasks_to_menu_mainloop_id = Mainloop.idle_add(() => {
           this._add_tasks_to_menu__finish(n, arr, update_tasks_viewport,
                                           ignore_filters, false);
        });
    },

    _add_tasks_to_menu__finish: function (i, arr, update_tasks_viewport,
                                          ignore_filters, scrollbar_shown) {

        if (!scrollbar_shown && this.ext.needs_scrollbar()) {
            this.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
            scrollbar_shown = true;
        }

        if (i === arr.length) {
            this.add_tasks_to_menu_mainloop_id = null;
            return;
        }

        if (update_tasks_viewport) {
            if (ignore_filters || this._filter_test(arr[i])) {
                this.tasks_viewport.push(arr[i]);
                this.tasks_scroll_content.add_child(arr[i].actor);
            }
        }
        else this.tasks_scroll_content.add_child(arr[i].actor);

        arr[i].actor.visible = this.ext.menu.isOpen &&
                               this.tasks_scroll_wrapper.visible;

        this.add_tasks_to_menu_mainloop_id = Mainloop.idle_add(() => {
            this._add_tasks_to_menu__finish(++i, arr, update_tasks_viewport,
                                            ignore_filters, scrollbar_shown);
        });
    },

    // Append the task strings of each given task to the current done.txt file.
    //
    // If a given task is not completed, it's task string will be updated to
    // show that it's completed prior to been appended to the done.txt file.
    //
    // The task objects will not be changed.
    //
    // @tasks: array (of task objects)
    archive_tasks: function (tasks) {
        let task_strings = [];

        let task;
        for (let i = 0, len = tasks.length; i < len; i++) {
            task = tasks[i];

            if (!task.completed) {
                if (task.priority !== '(_)') {
                    task_strings.push('x ' +
                                      date_yyyymmdd() +
                                      task.task_str.slice(3) +
                                      ' pri:' + task.priority[1]);
                }
                else {
                    task_strings.push(
                        'x ' + date_yyyymmdd() + ' ' + task.task_str);
                }
            }
            else {
                task_strings.push(task.task_str);
            }
        }

        try {
            let current   = this.settings.get_value('todo-current').deep_unpack();
            let done_file = Gio.file_new_for_uri(current.done_file);

            if (!done_txt_file || !done_txt_file.query_exists(null))
                done_txt_file.create(Gio.FileCreateFlags.NONE, null);

            let append_stream = done_txt_file.append_to(
                Gio.FileCreateFlags.NONE, null);

            append_stream.write_all(task_strings.join('\n'), null);
        }
        catch (e) { logError(e); }
    },

    // A predicate used to determine whether a task inside the this.tasks array
    // will be added to the this.tasks_viewport array (i.e., whether it can be
    // visible to the user).
    //
    // @task: obj (a task object)
    //
    // If invert_filters is false, return true if at least one filter is matched.
    // If invert_filters is true, return false if at least one filter is matched.
    _filter_test: function (task) {
        if (this.cache.filters.hidden)      return task.hidden;
        if (task.hidden)                    return false;
        if (this.cache.filters.recurring)   return Boolean(task.rec_str);
        if (task.rec_str && task.completed) return false;
        if (! this.has_active_filters())    return true;

        if (task.completed) {
            if (this.cache.filters.completed)
                return !this.cache.filters.invert_filters;
        }
        else if (task.priority === '(_)') {
            if (this.cache.filters.no_priority)
                return !this.cache.filters.invert_filters;
        }

        let i, arr, len;

        arr = this.cache.filters.priorities;
        for (i = 0, len = arr.length; i < len; i++) {
            if (arr[i] === task.priority)
                return !this.cache.filters.invert_filters;
        }

        arr = this.cache.filters.contexts;
        for (i = 0, len = arr.length; i < len; i++) {
            if (task.contexts.indexOf(arr[i]) !== -1)
                return !this.cache.filters.invert_filters;
        }

        arr = this.cache.filters.projects;
        for (i = 0, len = arr.length; i < len; i++) {
            if (task.projects.indexOf(arr[i]) !== -1)
                return !this.cache.filters.invert_filters;
        }

        arr = this.cache.filters.custom_active;
        for (i = 0, len = arr.length; i < len; i++) {
            if (FUZZ.fuzzy_search_v1(arr[i], task.task_str) !== null)
                return !this.cache.filters.invert_filters;
        }

        return this.cache.filters.invert_filters;
    },

    // Returns true if there are any active filters, else false.
    has_active_filters: function () {
        if (this.cache.filters.recurring         ||
            this.cache.filters.hidden            ||
            this.cache.filters.completed         ||
            this.cache.filters.no_priority       ||
            this.cache.filters.priorities.length ||
            this.cache.filters.contexts.length   ||
            this.cache.filters.projects.length   ||
            this.cache.filters.custom_active.length) {

            return true;
        }

        return false;
    },

    // Add context/project/prio as new active filter.
    //
    // @keyword: string (priority, context, or project)
    activate_filter: function (keyword) {
        let arr;

        if      (REG_PRIO.test(keyword))    arr = this.cache.filters.priorities;
        else if (REG_CONTEXT.test(keyword)) arr = this.cache.filters.contexts;
        else if (REG_PROJ.test(keyword))    arr = this.cache.filters.projects;

        if (arr.indexOf(keyword) !== -1) return;

        arr.push(keyword);
        this.store_cache();
        this._update_filter_icon();

        if (this.view_manager.current_view === View.DEFAULT)
            this.add_tasks_to_menu(true);
    },

    _update_filter_icon: function () {
        if (this.has_active_filters())
            this.filter_button.add_style_class_name('active');
        else
            this.filter_button.remove_style_class_name('active');
    },

    // This func will sort this.tasks array as well as call add_tasks_to_menu to
    // rebuild this.tasks_viewport.
    sort_tasks: function () {
        let property_map = {
            [SortType.COMPLETED]       : 'completed',
            [SortType.PRIORITY]        : 'priority',
            [SortType.DUE_DATE]        : 'due_date',
            [SortType.CONTEXT]         : 'first_context',
            [SortType.PROJECT]         : 'first_project',
            [SortType.CREATION_DATE]   : 'creation_date',
            [SortType.COMPLETION_DATE] : 'completion_date',
        };

        let i     = 0;
        let len   = this.cache.sort.length;
        let props = Array(len);

        for (; i < len; i++) {
            props[i] = property_map[ this.cache.sort[i][0] ];
        }

        this.tasks.sort((a, b) => {
            for (i = 0; (i < len) && (a[props[i]] === b[props[i]]); i++);

            if (i === len) return 0;

            switch (this.cache.sort[i][0]) {
                case SortType.PRIORITY:
                    if (this.cache.sort[i][1] === SortOrder.DESCENDING) {
                        return +(a[props[i]] > b[props[i]]) ||
                               +(a[props[i]] === b[props[i]]) - 1;
                    }
                    else {
                        return +(a[props[i]] < b[props[i]]) ||
                               +(a[props[i]] === b[props[i]]) - 1;
                    }

                default:
                    if (this.cache.sort[i][1] === SortOrder.DESCENDING) {
                        return +(a[props[i]] < b[props[i]]) ||
                               +(a[props[i]] === b[props[i]]) - 1;
                    }
                    else {
                        return +(a[props[i]] > b[props[i]]) ||
                               +(a[props[i]] === b[props[i]]) - 1;
                    }
            }
        });

        this.add_tasks_to_menu(true);

        // Update sort icon.
        //
        // @BUG
        // Although everything works anyway, clutter has failed assertions
        // without later_add.
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            this.sort_icon.icon_name =
                this.cache.sort[0][1] === SortOrder.ASCENDING ?
                'timepp-sort-ascending-symbolic' :
                'timepp-sort-descending-symbolic';
        });
    },

    // Each search query and the corresponding array of results (task objects)
    // is stored in a dictionary. If the current search query is in the dict, we
    // just use the corresponding results. If a search query in the dict is a
    // prefix of the current search query, we execute a search on the results
    // of the prefix query (search space reduced.)
    //
    // The dictionary is only maintained for the duration of the search.
    _search: function () {
        if (this.view_manager.current_view !== View.SEARCH)
            return;

        if (this.add_tasks_to_menu_mainloop_id) {
            Mainloop.source_remove(this.add_tasks_to_menu_mainloop_id);
            this.add_tasks_to_menu_mainloop_id = null;
        }

        let pattern = this.search_entry.get_text().trim().toLowerCase();

        if (pattern === '') {
            this.last_search_pattern = '';
            this.tasks_viewport = this.tasks;
            this.add_tasks_to_menu();
            return;
        }

        this.last_search_pattern = pattern;
        let [search_needed, search_space] = this._find_prev_search_results(pattern);

        if (! search_needed) {
            this.tasks_viewport = search_space;
            this.add_tasks_to_menu();
            return;
        }

        this._do_search(pattern, search_space);
    },

    _do_search: function (pattern, search_space) {
        let reduced_results = [];
        let i, len, score;

        for (i = 0, len = search_space.length; i < len; i++) {
            score = FUZZ.fuzzy_search_v1(pattern, search_space[i].task_str.toLowerCase());
            if (score !== null) reduced_results.push([i, score]);
        }

        reduced_results.sort((a, b) => b[1] - a[1]);

        len = reduced_results.length;

        this.tasks_viewport = new Array(len);

        for (i = 0; i < len; i++) {
            this.tasks_viewport[i] = search_space[ reduced_results[i][0] ];
        }

        this.search_dictionary.set(pattern, this.tasks_viewport);
        this.add_tasks_to_menu();
    },

    _find_prev_search_results: function (pattern) {
        let res = '';

        for (let [old_patt,] of this.search_dictionary.entries())
            if (pattern.startsWith(old_patt) && old_patt.length > res.length)
                res = old_patt;

        if (pattern === res) return [false, this.search_dictionary.get(res)];
        else if (res)        return [true,  this.search_dictionary.get(res)];
        else                 return [true,  this.tasks];
    },
});
Signals.addSignalMethods(Todo.prototype);



// =====================================================================
// @@@ Task Editor UI
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @task     : obj (optional)
//
// @signals:
//   - 'add-task'    (returns task string)
//   - 'edit-task'   (returns task string)
//   - 'delete-task' (returns bool; if true, the task is to be archived as well)
//   - 'cancel'
//
// If @task is provided, then the entry will be prepopulated with the task_str
// of that task object and the signals 'delete-task' and 'edit-task' will be
// used instead of 'add-task'.
// =====================================================================
const TaskEditor = new Lang.Class({
    Name: 'Timepp.TaskEditor',

    _init: function (ext, delegate, task) {
        this.ext      = ext;
        this.delegate = delegate;

        this.curr_selected_completion   = null;
        this.current_word_start         = 0;
        this.current_word_end           = 0;
        this.text_changed_handler_block = false;


        // One of: 'edit-task', 'add-task'.
        this.mode = task ? 'edit-task' : 'add-task';


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box task-editor' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // entry
        //
        this.entry_container = new St.BoxLayout({ vertical: true, style_class: 'row entry-container' });
        this.content_box.add_child(this.entry_container);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Task...'), true, true);
        this.entry_container.add_actor(this.entry.actor);

        this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.entry.scroll_box.hscrollbar_policy = Gtk.PolicyType.NEVER;

        if (this.mode === 'edit-task') {
            this.text_changed_handler_block = true;

            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                this.entry.entry.set_text(task.task_str);
                this.entry._resize_entry();
                this.text_changed_handler_block = false;
            });
        }


        //
        // used to show project/context completions
        //
        this.completion_menu = new St.ScrollView({ visible: false, style_class: 'vfade' });

        this.completion_menu.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.completion_menu.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.entry_container.add_child(this.completion_menu);

        this.completion_menu_content = new St.BoxLayout({ vertical: true, reactive: true, style_class: 'view-box-content completion-box' });
        this.completion_menu.add_actor(this.completion_menu_content);


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ style_class: 'row btn-box' });
        this.content_box.add_actor(this.btn_box);

        if (this.mode === 'edit-task') {
            this.button_delete = new St.Button({ can_focus: true, label: _('Delete'), style_class: 'btn-delete button', x_expand: true });
            this.btn_box.add(this.button_delete, {expand: true});
            this.button_delete.connect('clicked', () => this.emit('delete-task'));
        }

        let current = this.delegate.settings.get_value('todo-current').deep_unpack();

        if (this.mode === 'edit-task' && current.done_file && !task.hidden) {
            this.button_archive = new St.Button({ can_focus: true, label: _('Archive'), style_class: 'btn-delete button', x_expand: true });
            this.btn_box.add(this.button_archive, {expand: true});
            this.button_archive.connect('clicked', () => this.emit('delete-task', true));
        }

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button', x_expand: true });
        this.btn_box.add(this.button_cancel, {expand: true});

        this.button_ok = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button', x_expand: true });
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.button_ok.connect('clicked', () => {
            this.emit(this.mode, this._create_task_str());
        });
        this.button_cancel.connect('clicked', () => {
           this.emit('cancel');
        });
        this.entry.entry.clutter_text.connect('text-changed', () => {
            if (this.text_changed_handler_block)
                return Clutter.EVENT_PROPAGATE;

            Mainloop.idle_add(() => {
                let word = this._get_current_word();
                if (word) this._show_completions(word);
                else this.completion_menu.hide();
            });
        });
        this.entry.entry.connect('key-press-event', (_, event) => {
            let symbol = event.get_key_symbol();

            if (this.completion_menu.visible && symbol === Clutter.Tab) {
                this._on_tab();
                return Clutter.EVENT_STOP;
            }
        });
        this.entry.entry.clutter_text.connect('activate', () => {
            if (this.completion_menu.visible) this._on_completion_selected();
        });
        this.entry.entry.connect('queue-redraw', () => {
            this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (ext.needs_scrollbar())
                this.entry.scroll_box.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
        this.completion_menu_content.connect('queue-redraw', () => {
            this.completion_menu.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (this.ext.needs_scrollbar())
                this.completion_menu.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
    },

    // @word: string (a context or project)
    _show_completions: function (word) {
        let completions = null;

        if (word[0] === '@')
            completions = this._find_completions(word, this.delegate.stats.contexts);
        else if (word[0] === '+')
            completions = this._find_completions(word, this.delegate.stats.projects);

        if (!completions || completions.length === 0) {
            this.completion_menu.hide();
            return;
        }

        this.completion_menu_content.remove_all_children();
        this.completion_menu.show();

        for (let i = 0; i < completions.length; i++)  {
            let item = new St.Button({ label: completions[i], reactive: true, track_hover: true, x_align: St.Align.START, style_class: 'row popup-menu-item' });
            this.completion_menu_content.add_child(item);

            item.connect('notify::hover', (item) => {
                this._on_completion_hovered(item);
            });
            item.connect('clicked', (item) => {
                this._on_completion_selected();
            });
        }

        this.completion_menu_content.first_child.pseudo_class = 'active';
        this.curr_selected_completion = this.completion_menu_content.first_child;
    },

    // @needle   : string (a context or project)
    // @haystack : map    (of all contexts or projects);
    //
    // If @needle is a context, then the @haystack has to be the map of all
    // contexts. Likewise for projects.
    _find_completions: function (needle, haystack) {
        if (needle === '@' || needle === '+') {
            let res = [];
            for (let [key,] of haystack.entries()) res.push(key);
            return res;
        }

        let reduced_results = [];

        let score;
        for (let [keyword,] of haystack.entries()) {
            score = FUZZ.fuzzy_search_v1(needle, keyword);
            if (!score) continue;
            reduced_results.push([score, keyword]);
        }

        reduced_results.sort((a, b) => a[0] < b[0]);

        let results = [];

        for (let i = 0, len = reduced_results.length; i < len; i++) {
            results[i] = reduced_results[i][1];
        }

        return results;
    },

    // Get the word that the cursor is currently on or null if the word is not
    // a context/project.
    _get_current_word: function () {
        let text = this.entry.entry.get_text();

        if (! text) return null;

        let len  = text.length;

        if (len === 0) return null;

        let pos = this.entry.entry.clutter_text.cursor_position;

        if (pos === -1) pos = len;

        if (pos === 0 || /\s/.test(text[pos - 1])) return null;

        if (pos === len || /\s/.test(text[pos])) pos--;

        let start = pos;
        while (start > 0 && text[start] !== ' ') start--;

        let end = pos;
        while (end < len && text[end] !== ' ') end++;

        if (text[start] === ' ') start++;
        if (end !== len && text[end] === ' ') end--;

        let word = text.substring(start, end + 1);

        this.current_word_start = start;
        this.current_word_end   = end;

        if (/[@+]/.test(word) || REG_CONTEXT.test(word) || REG_PROJ.test(word))
            return word;
        else
            return null;
    },

    _on_tab: function () {
        this.curr_selected_completion.pseudo_class = '';

        let next = this.curr_selected_completion.get_next_sibling();

        if (next) {
            this.curr_selected_completion = next;
            next.pseudo_class = 'active';
        }
        else {
            this.curr_selected_completion = this.completion_menu_content.first_child;
            this.curr_selected_completion.pseudo_class = 'active';
        }

        SCROLL_TO_ITEM.scroll(this.completion_menu,
                              this.completion_menu_content,
                              this.curr_selected_completion);
    },

    _on_completion_selected: function () {
        this.completion_menu.hide();

        let completion = this.curr_selected_completion.label;

        let text = this.entry.entry.get_text().slice(0, this.current_word_start) +
                   completion +
                   this.entry.entry.get_text().slice(this.current_word_end + 1);


        this.text_changed_handler_block = true;

        this.entry.entry.text = text;

        // @BUG or feature?
        // Setting the cursor pos directly seeems to also select the text, so
        // use this func instead.
        let p = this.current_word_start + completion.length;
        this.entry.entry.clutter_text.set_selection(p, p);

        this.text_changed_handler_block = false;
    },

    _on_completion_hovered: function (item) {
        this.curr_selected_completion.pseudo_class = '';
        this.curr_selected_completion = item;
        item.pseudo_class = 'active';
    },

    _create_task_str: function () {
        if (this.mode === 'edit-task') return this.entry.entry.get_text();

        // If in add mode, we insert a creation date if the user didn't do it.
        let words = this.entry.entry.get_text().split(/ +/);

        if (words[0] === 'x') {
            if (!Date.parse(words[1]))
                words.splice(1, 0, date_yyyymmdd(), date_yyyymmdd());
            else if (words[2] && !Date.parse(words[2]))
                words.splice(2, 0, date_yyyymmdd());
        }
        else if (REG_PRIO.test(words[0])) {
            if (words[1] && !Date.parse(words[1]))
                words.splice(1, 0, date_yyyymmdd());
        }
        else if (!Date.parse(words[0])) {
            words.splice(0, 0, date_yyyymmdd());
        }

        return words.join(' ');
    },
});
Signals.addSignalMethods(TaskEditor.prototype);



// =====================================================================
// @@@ Task item/object including the actor to be drawn in the popup menu.
//
// @ext                 : obj (main extension object)
// @delegate            : obj (main section object)
// @task_str            : string (a single line in todo.txt file)
// @do_check_recurrence : bool
//
// If @do_check_recurrence is true, then the task object will check to
// to see if it needs to reopen in case it has a recurrence, and
// as a result may end up updating it's task_str.
// To know whether or not a task obj has recurred, one can set this param
// to false and use the check_recurrence() method manually, which will
// return a bool.
// Setting this param to false is useful when we don't intend to update
// the todo.txt file but must in case a task recurs. (E.g., when we load
// tasks from the todo.txt file.)
// =====================================================================
const TaskItem = new Lang.Class({
    Name: 'Timepp.TaskItem',

    _init: function (ext, delegate, task_str, do_check_recurrence = true) {
        this.ext      = ext;
        this.delegate = delegate;
        this.task_str = task_str;

        // @NOTE
        // If a var needs to be resettable, add it to the reset() method
        // instead of the _init() method.=

        // Project/context/url below mouse pointer, null if none of those.
        this.current_keyword = null;


        //
        // container
        //
        this.actor = new St.Bin({ reactive: true, style: 'width: ' + this.delegate.settings.get_int('todo-task-width') + 'px;', x_fill: true, style_class: 'task-item' });

        this.task_item_content = new St.BoxLayout({ vertical: true, style_class: 'task-item-content' });
        this.actor.add_actor(this.task_item_content);


        //
        // header
        //
        this.header = new St.BoxLayout({ style_class: 'task-item-header' });
        this.task_item_content.add_actor(this.header);


        //
        // checkbox
        //
        this.completion_checkbox = new St.Button({ style_class: 'check-box', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
        this.header.add_child(this.completion_checkbox);

        let checkmark = new St.Bin();
        this.completion_checkbox.add_actor(checkmark);


        //
        // priority label
        //
        this.prio_label = new St.Label({ visible: false, reactive: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'priority-label' });
        this.header.add_child(this.prio_label);


        //
        // due date label
        //
        this.due_date_label = new St.Label({ visible: false, y_align: Clutter.ActorAlign.CENTER, style_class: 'due-date-label' });
        this.header.add_child(this.due_date_label);


        //
        // recurrence date label
        //
        this.rec_date_label = new St.Label({ visible: false, y_align: Clutter.ActorAlign.CENTER, style_class: 'recurrence-date-label' });
        this.header.add_child(this.rec_date_label);


        //
        // body
        //
        this.msg = new St.Label({ reactive: true, y_align: Clutter.ActorAlign.CENTER, x_align: St.Align.START, style_class: 'description-label'});
        this.task_item_content.add_child(this.msg);

        if (! task_str) this.msg.hide();

        this.msg.clutter_text.line_wrap      = true;
        this.msg.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
        this.msg.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;


        //
        // date labels (creation/completion/due)
        //
        this.date_labels = new St.Label({ visible: false, y_align: Clutter.ActorAlign.CENTER, x_align: St.Align.START, style_class: 'date-label popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.task_item_content.add_child(this.date_labels);

        this.date_labels.clutter_text.line_wrap      = true;
        this.date_labels.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.date_labels.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;


        //
        // init the remaining vars and parse task string
        //
        this.reset(do_check_recurrence);


        //
        // listen
        //
        this.actor.connect('queue-redraw', () => {
            if (this.delegate.tasks_scroll.vscrollbar_visible ||
                ! this.delegate.tasks_scroll_wrapper.visible) {

                return;
            }

            resize_label(this.msg);
        });
        this.actor.connect('event', (actor, event) => {
            this._on_event(actor, event);
            return Clutter.EVENT_PROPAGATE;
        });
        this.prio_label.connect('leave-event', () => {
            global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.prio_label.connect('enter-event', () => {
            global.screen.set_cursor(Meta.Cursor.POINTING_HAND);
        });
        this.msg.connect('leave-event', () => {
            global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.msg.connect('motion-event', (_, event) => {
            this.current_keyword = this._find_keyword(event);
            if (this.current_keyword)
                global.screen.set_cursor(Meta.Cursor.POINTING_HAND);
            else
                global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
        this.completion_checkbox.connect('clicked', () => {
            this.toggle_task();
            this.delegate.add_task_button.grab_key_focus();
            this.delegate.on_tasks_changed();
            this.delegate.write_tasks_to_file();
        });
    },

    reset: function (do_check_recurrence = true, task_str) {
        if (task_str) {
            this.delegate.time_tracker.update_record_name(this.task_str, task_str);
            this.task_str = task_str;
        }

        // For sorting purposes, we set the prio to '(_)' when there is no prio.
        this.priority                    = '(_)';
        this.projects                    = [];
        this.contexts                    = [];
        // For sorting purposes, we set the dates to this when they don't exist.
        this.creation_date               = '0000-00-00';
        this.completion_date             = '0000-00-00';
        this.due_date                    = '9999-99-99';
        this.prio_label.visible          = false;
        this.prio_label.text             = '';
        this.due_date_label.visible      = false;
        this.due_date_label.text         = '';
        this.rec_date_label.visible      = false;
        this.rec_date_label.text         = '';
        this.date_labels.visible         = false;
        this.date_labels.text            = '';
        this.actor.style_class           = 'task-item';
        this.completed                   = false;
        this.completion_checkbox.checked = false;
        this.completion_checkbox.visible = true;
        this.tracker_id                  = '';

        if (this.hidden) {
            this.header.remove_child(this.header.get_child_at_index(0));
        }
        this.hidden = false;

        // These vars are only used for sorting purposes. They hold the first
        // context/project keyword as they appear in the task_str. If there are
        // no contexts/projects, they are ''.
        // They are set by the _parse_task_str() func.
        this.first_context = '';
        this.first_project = '';

        // The recurrence type is one of: 1, 2, 3
        // The numbers just match the global regex REG_REC_EXT_[123]
        this.rec_type = 1;
        this.rec_str  = '';

        // These vars are used by the update_markup_colors() func to make it
        // possible to update the context/project/url colors without having to
        // re-parse the whole task_str.
        // They are set by the _parse_task_str() func.
        // this.description_markup is an array of marked up words that make up
        // the 'description' part of the task_str sans any extensions.
        // E.g., ['<span foreground="blue">@asdf</span>', ...].
        this.description_markup = null;
        this.context_indices    = [];
        this.project_indices    = [];
        this.link_indices       = [];

        this._parse_task_str();
        if (do_check_recurrence && this.rec_str) this.check_recurrence();
    },

    _parse_task_str: function () {
        // The 'header' is part of the task_str at the start that includes
        // the 'x' (checked) sign, the priority, and the completion/creation
        // dates.
        // The 'description' is everything else.

        let words    = split_on_spaces(this.task_str);
        let len      = words.length;
        let desc_pos = 0; // idx of first word of 'description' in words arr


        //
        // Parse 'header'
        //
        if (words[0] === 'x') {
            this.completed                   = true;
            this.completion_checkbox.checked = true;
            this.actor.add_style_class_name('completed');

            if (len >= 1 & REG_DATE.test(words[1]) && Date.parse(words[1])) {
                this.completion_date      = words[1];
                // TRANSLATORS: 'completed:' is followed by a date
                this.date_labels.text    += _('completed:') + words[1] + '   ';
                this.date_labels.visible  = true;

                if (len >= 2 && REG_DATE.test(words[2]) && Date.parse(words[2])) {
                    this.creation_date        = words[2];
                    // TRANSLATORS: 'created:' is followed by a date
                    this.date_labels.text    += _('created:') + words[2] + '   ';
                    this.date_labels.visible  = true;
                    desc_pos                  = 3;
                }
                else desc_pos = 2;
            }
            else desc_pos = 1;
        }
        else if (REG_PRIO.test(words[0])) {
            this.actor.add_style_class_name(words[0][1]);
            this.prio_label.visible = true;
            this.prio_label.text    = words[0];
            this.priority           = words[0];

            if (len >= 1 && REG_DATE.test(words[1]) && Date.parse(words[1])) {
                this.creation_date        = words[1];
                this.date_labels.text    += _('created:') + words[1] + '   ';
                this.date_labels.visible  = true;
                desc_pos                  = 2;
            }
            else desc_pos = 1;
        }
        else if (REG_DATE.test(words[0]) && Date.parse(words[0])) {
            this.creation_date       = words[0];
            this.date_labels.text   += _('created:') + words[0] + '   ';
            this.date_labels.visible = true;
            desc_pos                 = 1;
        }


        //
        // Parse 'description'
        //
        words = words.slice(desc_pos, len);
        len = words.length;
        let word;

        for (let i = 0; i < len; i++) {
            word = words[i];

            if (REG_CONTEXT.test(word)) {
                this.context_indices.push(i);
                if (this.contexts.indexOf(word) === -1) {
                    this.contexts.push(word);
                }
                words[i] = '<span foreground="' +
                           this.delegate.markup_colors.context +
                           '"><b>' + word + '</b></span>';
            }
            else if (REG_PROJ.test(word)) {
                this.project_indices.push(i);
                if (this.projects.indexOf(word) === -1) {
                    this.projects.push(word);
                }
                words[i] = '<span foreground="' +
                           this.delegate.markup_colors.project +
                           '"><b>' + word + '</b></span>';
            }
            else if (REG_URL.test(word) || REG_FILE_PATH.test(word)) {
                this.link_indices.push(i);
                words[i] = '<span foreground="' +
                           this.delegate.markup_colors.link +
                           '"><u><b>' + word + '</b></u></span>';
            }
            else if (REG_EXT.test(word)) {
                if (this.hidden) {
                    // Ignore all other extensions if task is hidden.
                    continue;
                }
                else if (REG_HIDE_EXT.test(word)) {
                    this.completion_checkbox.hide();
                    this.prio_label.hide();
                    this.due_date_label.hide();
                    this.due_date_label.text = '';
                    this.rec_date_label.hide();
                    this.rec_date_label.text = '';
                    this.date_labels.hide();
                    if (this.edit_icon_bin) this.edit_icon_bin.hide();

                    this.tracker_id = '';
                    this.priority   = '(_)';
                    this.hidden     = true;
                    this.completed  = false;
                    this.completion_checkbox.checked = false;
                    this.actor.add_style_class_name('hidden-task');

                    let icon_incognito_bin = new St.Button({ can_focus: true });
                    this.header.insert_child_at_index(icon_incognito_bin, 0);
                    let icon_incognito = new St.Icon();
                    icon_incognito_bin.add_actor(icon_incognito);
                    icon_incognito.icon_name = 'timepp-hidden-symbolic';

                    words.splice(i, 1); i--; len--;
                }
                else if (REG_DUE_EXT.test(word) && !this.rec_str) {
                    this.due_date = word.slice(4);
                    this.due_date_label.text   += _('due:') + word.slice(4);
                    this.due_date_label.visible = true;
                    this.update_due_date();

                    words.splice(i, 1); i--; len--;
                }
                else if (REG_REC_EXT_1.test(word) &&
                         this.creation_date !== '0000-00-00') {

                    this.due_date_label.visible = false;
                    this.due_date_label.text    = '';
                    this.rec_str  = word;
                    this.rec_type = 1;

                    words.splice(i, 1); i--; len--;
                }
                else if (REG_REC_EXT_2.test(word) &&
                         (!this.completed ||
                          this.completion_date !== '0000-00-00')) {

                    this.due_date_label.visible = false;
                    this.due_date_label.text    = '';
                    this.rec_str  = word;
                    this.rec_type = 2;

                    words.splice(i, 1); i--; len--;
                }
                else if (REG_REC_EXT_3.test(word) &&
                         this.creation_date !== '0000-00-00') {

                    this.due_date_label.visible = false;
                    this.due_date_label.text    = '';
                    this.rec_str  = word;
                    this.rec_type = 3;

                    words.splice(i, 1); i--; len--;
                }
                else if (REG_TRACKER_ID_EXT.test(word)) {
                    this.tracker_id = word.slice(11);

                    words.splice(i, 1); i--; len--;
                }
                else if (REG_PRIO_EXT.test(word)) {
                    words.splice(i, 1); i--; len--;
                }
            }
        }

        if (this.contexts.length > 0) this.first_context = this.contexts[0];
        if (this.projects.length > 0) this.first_project = this.projects[0];

        this.description_markup = words;

        // We escape '&' and '<'.
        this.msg.clutter_text.set_markup(
           words.join(' ').replace(/&(?!amp;|quot;|apos;|lt;|gt;)/g, '&amp;')
                          .replace(/<(?!\/?.*>)/g, '&lt;')
        );
    },

    check_recurrence: function () {
        if (! this.rec_str) return false;

        let [do_recur, next_rec, days] = this._get_recurrence_date();

        if (do_recur) {
            // update/insert creation date
            let words = this.task_str.split(/ +/);
            let idx;

            if      (this.completed)          idx = 2;
            else if (this.priority !== '(_)') idx = 1;
            else                              idx = 0;

            if (REG_DATE.test(words[idx])) words[idx] = date_yyyymmdd();
            else                           words.splice(idx, 0, date_yyyymmdd());

            this.task_str = words.join(' ');

            if (this.completed) this.toggle_task();
            else                this.reset(true);

            return do_recur;
        }

        if (next_rec) {
            this.rec_date_label.show();
            // TRANSLATORS: %s is a date string in yyyy-mm-dd format
            this.rec_date_label.text =
                ngettext('recurs:%s (in %d day)', 'recurs:%s (in %d days)',
                         days).format(next_rec, days);
        }

        return do_recur;
    },

    // This function assumes that the creation/completion dates are either valid
    // or equal to '0000-00-00' and that if a particular type of recurrence
    // needs a creation/completion date that it will be already there.  This is
    // all done in the _parse_task_str func.
    //
    // returns array : [do_recur, next_recurrence, days_until]
    //
    // @do_recur        : bool    (whether or not the task should recur today)
    // @next_recurrence : string  (date of next recurrence in yyyy-mm-dd format)
    // @days_until      : natural (days until next recurrence)
    //
    // @next_recurrence can be an empty string, which indicates that the next
    // recurrence couldn't be computed. E.g., the task recurs n days after
    // completion but isn't completed.
    _get_recurrence_date: function () {
        let res   = [false, '', 0];
        let today = date_yyyymmdd();

        if (this.rec_type === 3) {
            let increment =
                +(this.rec_str.slice(this.rec_str.indexOf('-') + 1, -1));

            let year  = +(this.creation_date.substr(0, 4));
            let month = +(this.creation_date.substr(5, 2));
            let day   = +(this.rec_str.slice(this.rec_str.indexOf(':') + 1,
                                             this.rec_str.indexOf('d')));
            let iter  = "%d-%02d-%02d".format(year, month, day);

            while (iter < today) {
                month += increment;
                year  += Math.floor(month / 12);
                month %= 12;

                if (month === 0) {
                    month = 12;
                    year--;
                }

                iter   = "%d-%02d-%02d".format(year, month, day);
            }

            while (! Date.parse(iter)) {
                iter = "%d-%02d-%02d".format(year, month, --day);
            }

            // We never recur a task on date that it was created on since
            // it would be impossible to close it on that date.
            res[0] = (iter === today) && (this.creation_date !== today);

            // - If the recurrence is today, we increment one more time to have
            //   the next recurrence.
            // - If creation date is in the future(iter === this.creation_date),
            //   we increment one more time since the recurrence can never
            //   happen on the date of creation.
            if (res[0] || iter === this.creation_date) {
                month += increment;
                year  += Math.floor(month / 12);
                month %= 12;

                if (month === 0) {
                    month = 12;
                    year--;
                }

                iter   = "%d-%02d-%02d".format(year, month, day);

                while (! Date.parse(iter)) {
                    iter = "%d-%02d-%02d".format(year, month, --day);
                }
            }

            res[1] = iter;
            res[2] = Math.round(
                (Date.parse(iter+'T00:00:00') - Date.parse(today+'T00:00:00')) /
                86400000
            );
        }
        else {
            let reference_date, rec_str_offset;

            if (this.rec_type === 2) {
                // An incompleted task has no completion date; therefore, we
                // cannot compute the next recurrence.
                if (this.completion_date === '0000-00-00') return res;

                reference_date = this.completion_date;
                rec_str_offset = 6;
            }
            else {
                reference_date = this.creation_date;
                rec_str_offset = 4;
            }

            let iter      = new Date(reference_date + 'T00:00:00');
            let increment = +(this.rec_str.slice(rec_str_offset, -1)) *
                (this.rec_str[this.rec_str.length - 1] === 'w' ? 7 : 1);

            while (date_yyyymmdd(iter) < today) {
                iter.setDate(iter.getDate() + increment);
            }

            res[0] = date_yyyymmdd(iter) === today && reference_date !== today;

            if (res[0] || date_yyyymmdd(iter) === reference_date)
                iter.setDate(iter.getDate() + increment);

            res[1] = date_yyyymmdd(iter);
            res[2] = Math.round(
                (iter.getTime() - Date.parse(today + 'T00:00:00')) / 86400000);
        }

        return res;
    },

    update_markup_colors: function () {
        let i, idx;

        for (i = 0; i < this.context_indices.length; i++) {
            idx = this.context_indices[i];

            this.description_markup[idx] =
                '<span foreground="' +
                this.delegate.markup_colors.context + '"' +
                this.description_markup[idx].slice(
                    this.description_markup[idx].indexOf('>'));
        }

        for (i = 0; i < this.project_indices.length; i++) {
            idx = this.project_indices[i];

            this.description_markup[idx] =
                '<span foreground="' +
                this.delegate.markup_colors.project + '"' +
                this.description_markup[idx].slice(
                    this.description_markup[idx].indexOf('>'));
        }

        for (i = 0; i < this.link_indices.length; i++) {
            idx = this.link_indices[i];

            this.description_markup[idx] =
                '<span foreground="' +
                this.delegate.markup_colors.link + '"' +
                this.description_markup[idx].slice(
                    this.description_markup[idx].indexOf('>'));
        }

        this.msg.clutter_text.set_markup(this.description_markup.join(' '));
    },

    update_due_date: function () {
        if (this.due_date === '9999-99-99') return;

        let diff = Math.round(
            (Date.parse(this.due_date + 'T00:00:00') -
             Date.parse(date_yyyymmdd() + 'T00:00:00'))
            / 86400000
        );
        let abs = Math.abs(diff);

        if (diff === 0)
            abs = _('today');
        else if (diff < 0)
            abs = ngettext('%d day ago', '%d days ago', abs).format(abs);
        else
            abs = ngettext('in %d day', 'in %d days', abs).format(abs);

        this.due_date_label.text = _('due:') + this.due_date + ' (' + abs + ')';
    },

    toggle_task: function () {
        this._hide_header_icons();

        if (this.completed) {
            let words = this.task_str.split(/ +/);

            // See if there's an old priority stored in an ext (e.g., pri:A).
            let prio  = '';
            for (let i = 0, len = words.length; i < len; i++) {
                if (REG_PRIO_EXT.test(words[i])) {
                    prio = '(' + words[i][4] + ') ';
                    words.splice(i, 1);
                    break;
                }
            }

            // remove the 'x' and completion date
            if (Date.parse(words[1])) words.splice(0, 2);
            else                      words.splice(0, 1);

            this.reset(true, prio + words.join(' '));
        }
        else {
            this.delegate.time_tracker.stop_tracking(this);

            if (this.priority === '(_)') {
                this.task_str = 'x ' + date_yyyymmdd() + ' ' + this.task_str;
            }
            else {
                this.task_str = 'x ' +
                                date_yyyymmdd() +
                                this.task_str.slice(3) +
                                ' pri:' + this.priority[1];
            }

            this.reset(true);
        }
    },

    _show_header_icons: function () {
        //
        // @SPEED
        // Lazy load the icons.
        //
        if (!this.header_icon_box) {
            // icon box
            this.header_icon_box = new St.BoxLayout({ x_align: Clutter.ActorAlign.END, style_class: 'icon-box' });
            this.header.add(this.header_icon_box, {expand: true});

            // statistics icon
            this.stat_icon_bin = new St.Button({ visible:false, can_focus: true, y_align: St.Align.MIDDLE });
            this.header_icon_box.add_actor(this.stat_icon_bin);

            this.stat_icon = new St.Icon({ icon_name: 'timepp-graph-symbolic' });
            this.stat_icon_bin.add_actor(this.stat_icon);


            // settings icon
            this.edit_icon_bin = new St.Button({ visible:false, can_focus: true, y_align: St.Align.MIDDLE });
            this.header_icon_box.add_actor(this.edit_icon_bin);

            this.edit_icon = new St.Icon({ icon_name: 'timepp-edit-symbolic' });
            this.edit_icon_bin.add_actor(this.edit_icon);


            // time tracker start button
            this.tracker_icon_bin = new St.Button({ visible:false, can_focus: true, y_align: St.Align.MIDDLE, style_class: 'tracker-start-icon'});
            this.header_icon_box.add_actor(this.tracker_icon_bin);

            this.tracker_icon = new St.Icon({ icon_name: 'timepp-start-symbolic' });
            this.tracker_icon_bin.add_actor(this.tracker_icon);


            // listen
            this.stat_icon_bin.connect('button-press-event', () => {
                this.delegate.show_view__time_tracker_stats(this);
                Mainloop.idle_add(() => { this._hide_header_icons(); });
            });
            this.stat_icon_bin.connect('key-press-event', (_, event) => {
                if (event.get_key_symbol() === Clutter.Return) {
                    this.delegate.show_view__time_tracker_stats(this);
                    Mainloop.idle_add(() => { this._hide_header_icons(); });
                }
            });
            this.edit_icon_bin.connect('button-press-event', () => {
                this.delegate.show_view__task_editor(this);
                Mainloop.idle_add(() => { this._hide_header_icons(); });
            });
            this.edit_icon_bin.connect('key-press-event', (_, event) => {
                if (event.get_key_symbol() === Clutter.Return) {
                    this.delegate.show_view__task_editor(this);
                    Mainloop.idle_add(() => { this._hide_header_icons(); });
                }
            });
            this.tracker_icon_bin.connect('button-press-event', () => {
                this.delegate.time_tracker.toggle_tracking(this);
                return Clutter.EVENT_STOP;
            });
            this.tracker_icon_bin.connect('key-press-event', (_, event) => {
                if (event.get_key_symbol() === Clutter.Return) {
                    this.delegate.time_tracker.toggle_tracking(this);
                }
            });
        }

        //
        // show icons
        //
        if (!this.hidden && !this.completion_checkbox.checked)
            this.tracker_icon_bin.show();

        if (this.actor.visible) {
            this.edit_icon_bin.show();
            if (!this.hidden) this.stat_icon_bin.show();
        }
    },

    _hide_header_icons: function () {
        if (! this.header_icon_box) return;

        this.stat_icon_bin.hide();
        this.edit_icon_bin.hide();
        if (this.tracker_icon_bin.style_class === 'tracker-start-icon')
            this.tracker_icon_bin.hide();
    },

    _toggle_tracker_icon: function () {
        if (this.tracker_icon_bin.style_class === 'tracker-start-icon')
            this._show_tracker_running_icon();
        else
            this._show_tracker_stopped_icon();
    },

    _show_tracker_running_icon: function () {
        this._show_header_icons();
        this.tracker_icon.icon_name       = 'timepp-stop-symbolic';
        this.tracker_icon_bin.style_class = 'tracker-pause-icon';
        this.tracker_icon_bin.visible     = true;
    },

    _show_tracker_stopped_icon: function () {
        this.tracker_icon.icon_name       = 'timepp-start-symbolic';
        this.tracker_icon_bin.style_class = 'tracker-start-icon';
        this.tracker_icon_bin.visible     = this.edit_icon_bin.visible;
    },

    on_tracker_started: function () {
        this._show_tracker_running_icon();
    },

    on_tracker_stopped: function () {
        this._show_tracker_stopped_icon();
    },

    // Return word under mouse cursor if it's a context or project, else null.
    _find_keyword: function (event) {
        let len = this.msg.clutter_text.text.length;

        // get screen coord of mouse
        let [x, y] = event.get_coords();

        // make coords relative to the msg actor
        [, x, y] = this.msg.transform_stage_point(x, y);

        // find pos of char that was clicked
        let pos = this.msg.clutter_text.coords_to_position(x, y);


        //
        // get word that contains the clicked char
        //
        let words   = split_on_spaces(this.msg.text);
        let i       = 0;
        let abs_idx = 0;

        outer: for (; i < words.length; i++) {
            for (let j = 0; j < words[i].length; j++) {
                if (abs_idx === pos) break outer;
                abs_idx++;
            }

            abs_idx++;
        }

        if (i > words.length - 1) return null;

        if (REG_CONTEXT.test(words[i]) || REG_PROJ.test(words[i]) ||
            REG_URL.test(words[i]) || REG_FILE_PATH.test(words[i]))
            return words[i];
        else
            return null;
    },

    _on_event: function (actor, event) {
        switch (event.type()) {
            case Clutter.EventType.ENTER: {
                this._show_header_icons();
                break;
            }

            case Clutter.EventType.LEAVE: {
                if (! this.header.contains(global.stage.get_key_focus()))
                    this._hide_header_icons();
                break;
            }

            case Clutter.EventType.KEY_RELEASE: {
                this._show_header_icons();
                SCROLL_TO_ITEM.scroll(this.delegate.tasks_scroll,
                                      this.delegate.tasks_scroll_content,
                                      actor);
                break;
            }

            case Clutter.EventType.KEY_PRESS: {
                Mainloop.idle_add(() => {
                    if (! this.header.contains(global.stage.get_key_focus()))
                        this._hide_header_icons();
                });
                break;
            }

            case Clutter.EventType.BUTTON_RELEASE: {
                if (this.prio_label.has_pointer) {
                    this.delegate.add_task_button.grab_key_focus();
                    this.delegate.activate_filter(this.priority);
                }
                else if (this.msg.has_pointer) {
                    if (! this.current_keyword) break;

                    this.delegate.add_task_button.grab_key_focus();

                    if (REG_URL.test(this.current_keyword)) {
                        if (this.current_keyword.indexOf(':') === -1)
                            this.current_keyword = 'https://' + this.current_keyword;

                        try {
                            Gio.app_info_launch_default_for_uri(this.current_keyword,
                                global.create_app_launch_context(0, -1));
                        }
                        catch (e) { logError(e); }
                    }
                    else if (REG_FILE_PATH.test(this.current_keyword)) {
                        let path = this.current_keyword;
                        path = path.replace(/\\ /g, ' ');

                        if (this.current_keyword[0] === '~') {
                            path = GLib.get_home_dir() + path.slice(1);
                        }

                        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                            try {
                                Gio.app_info_launch_default_for_uri(
                                    GLib.filename_to_uri(path, null),
                                    global.create_app_launch_context(0, -1));
                            }
                            catch (e) { logError(e); }
                        }
                        else {
                            Main.notify(_('File or dir not found.'));
                        }
                    }
                    else this.delegate.activate_filter(this.current_keyword);
                }

                break;
            }
        }
    },
});
Signals.addSignalMethods(TaskItem.prototype);



// =====================================================================
// @@@ Filter UI
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//  - 'filters-updated' returns obj with which to replace the cache.filters obj
// =====================================================================
const TaskFiltersWindow = new Lang.Class({
    Name: 'Timepp.TaskFiltersWindow',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        // We store all filter item objects here.
        // I.e., those objects created by the _new_filter_item() func.
        this.filter_register = {
            completed   : null,
            no_priority : null,
            priorities  : [],
            contexts    : [],
            projects    : [],
            custom      : [],
        };


        //
        // actor
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box filter-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // filters
        //
        this.filter_sectors_scroll = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.filter_sectors_scroll);

        this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.filter_sectors_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.filter_sectors_scroll_box = new St.BoxLayout({ vertical: true });
        this.filter_sectors_scroll.add_actor(this.filter_sectors_scroll_box);

        this.custom_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.custom_filters_box);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Add custom filter...'), false, true);
        this.custom_filters_box.add_child(this.entry.actor);

        this.priority_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.priority_filters_box);

        this.context_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.context_filters_box);

        this.project_filters_box = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row filter-settings-sector' });
        this.filter_sectors_scroll_box.add_actor(this.project_filters_box);


        this._add_separator(this.content_box);


        //
        // show hidden only switch
        //
        this.show_hidden_tasks_item = new St.BoxLayout({ style_class: 'row' });
        this.content_box.add_child(this.show_hidden_tasks_item);

        let show_hidden_tasks_label = new St.Label({ text: _('Show only hidden tasks'), y_align: Clutter.ActorAlign.CENTER });
        this.show_hidden_tasks_item.add(show_hidden_tasks_label, {expand: true});

        let hidden_count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.show_hidden_tasks_item.add_child(hidden_count_label);

        hidden_count_label.text = ngettext(
                '%d hidden task',
                '%d hidden tasks',
                this.delegate.stats.hidden).format(this.delegate.stats.hidden);

        this.show_hidden_tasks_toggle_btn = new St.Button({ can_focus: true });
        this.show_hidden_tasks_item.add_actor(this.show_hidden_tasks_toggle_btn);
        this.show_hidden_tasks_toggle = new PopupMenu.Switch();
        this.show_hidden_tasks_toggle_btn.add_actor(this.show_hidden_tasks_toggle.actor);


        //
        // show recurring only switch
        //
        this.show_recurring_tasks_item = new St.BoxLayout({ style_class: 'row' });
        this.content_box.add_child(this.show_recurring_tasks_item);

        let show_recurring_tasks_label = new St.Label({ text: _('Show only recurring tasks'), y_align: Clutter.ActorAlign.CENTER });
        this.show_recurring_tasks_item.add(show_recurring_tasks_label, {expand: true});

        let recurring_count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
        this.show_recurring_tasks_item.add_child(recurring_count_label);

        let n_recurring = this.delegate.stats.recurring_completed +
                          this.delegate.stats.recurring_incompleted;

        recurring_count_label.text =
            ngettext('%d recurring task', '%d recurring tasks', n_recurring)
            .format(n_recurring);

        this.show_recurring_tasks_toggle_btn = new St.Button({ can_focus: true });
        this.show_recurring_tasks_item.add_actor(this.show_recurring_tasks_toggle_btn);
        this.show_recurring_tasks_toggle = new PopupMenu.Switch();
        this.show_recurring_tasks_toggle_btn.add_actor(this.show_recurring_tasks_toggle.actor);


        //
        // Invert switch (whitelist/blacklist)
        //
        this.invert_item = new St.BoxLayout({ style_class: 'row' });
        this.content_box.add_child(this.invert_item);

        let invert_label = new St.Label({ text: _('Invert filters'), y_align: St.Align.END });
        this.invert_item.add(invert_label, {expand: true});

        this.invert_toggle_btn = new St.Button({ can_focus: true });
        this.invert_item.add_actor(this.invert_toggle_btn);
        this.invert_toggle = new PopupMenu.Switch();
        this.invert_toggle_btn.add_actor(this.invert_toggle.actor);


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(this.btn_box);

        this.button_reset = new St.Button({ can_focus: true, label: _('Reset'), style_class: 'button' });
        this.button_ok    = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button' });

        this.btn_box.add(this.button_reset, {expand: true});
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // load filter items
        //
        this._load_filters();


        //
        // listen
        //
        this.entry.entry.clutter_text.connect('key-focus-in', () => {
            SCROLL_TO_ITEM.scroll(this.filter_sectors_scroll,
                                  this.filter_sectors_scroll_box,
                                  this.custom_filters_box);
        });
        this.entry.entry.clutter_text.connect('activate', () => {
            if (! this.entry.entry.get_text()) return;

            // check for duplicates
            for (let i = 0; i < this.filter_register.custom.length; i++) {
                if (this.filter_register.custom[i].filter === this.entry.entry.get_text())
                    return;
            }

            let item = this._new_filter_item(true, this.entry.entry.get_text(), false,
                                             true, this.custom_filters_box);
            this.custom_filters_box.add_child(item.actor);
            this.filter_register.custom.push(item);
            this.entry.entry.text = '';
        });
        this.show_hidden_tasks_toggle_btn.connect('clicked', () => {
            this.show_hidden_tasks_toggle.toggle();
            if (this.show_hidden_tasks_toggle.state)
                this.show_recurring_tasks_toggle.setToggleState(false);
        });
        this.show_recurring_tasks_toggle_btn.connect('clicked', () => {
            this.show_recurring_tasks_toggle.toggle();
            if (this.show_recurring_tasks_toggle.state)
                this.show_hidden_tasks_toggle.setToggleState(false);
        });
        this.invert_toggle_btn.connect('clicked', () => {
            this.invert_toggle.toggle();
        });
        this.button_reset.connect('clicked', () => {
            this._reset_all();
        });
        this.button_ok.connect('clicked', () => {
            this._on_ok_clicked();
        });
        this.filter_sectors_scroll_box.connect('queue-redraw', () => {
            this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;

            if (this.ext.needs_scrollbar())
                this.filter_sectors_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
    },

    _load_filters: function () {
        let filters = this.delegate.cache.filters;

        this.invert_toggle.setToggleState(filters.invert_filters);
        this.show_hidden_tasks_toggle.setToggleState(filters.hidden);
        this.show_recurring_tasks_toggle.setToggleState(filters.recurring);


        let i, len, key, value, item, check;


        //
        // custom filters
        //
        len = filters.custom.length;
        for (i = 0; i < len; i++) {
            value = filters.custom[i];
            check = filters.custom_active.indexOf(value) === -1 ? false : true;
            item  = this._new_filter_item(check, value, 0, true, this.custom_filters_box);
            this.custom_filters_box.add_child(item.actor);
            this.filter_register.custom.push(item);
        }


        this._add_separator(this.priority_filters_box);


        //
        // completed
        //
        if (this.delegate.stats.completed > 0) {
            item = this._new_filter_item(filters.completed, _('Completed'),
                this.delegate.stats.completed, 0, this.priority_filters_box);
            this.filter_register.completed = item;
            this.priority_filters_box.add_child(item.actor);
        }


        //
        // no priority
        //
        if (this.delegate.stats.no_priority > 0) {
            item = this._new_filter_item(filters.no_priority, _('No Priority'),
                this.delegate.stats.no_priority, 0, this.priority_filters_box);
            this.filter_register.no_priority = item;
            this.priority_filters_box.add_child(item.actor);
        }


        //
        // priorities
        //
        for ([key, value] of this.delegate.stats.priorities.entries()) {
            check = filters.priorities.indexOf(key) === -1 ? false : true;
            item  = this._new_filter_item(check, key, value, false, this.priority_filters_box);
            this.filter_register.priorities.push(item);
        }

        this.filter_register.priorities.sort((a, b) => {
            return +(a.filter > b.filter) || +(a.filter === b.filter) - 1;
        });

        for (i = 0; i < this.filter_register.priorities.length; i++) {
            this.priority_filters_box.add_child(this.filter_register.priorities[i].actor);
        }


        this._add_separator(this.context_filters_box);


        //
        // contexts
        //
        for ([key, value] of this.delegate.stats.contexts.entries()) {
            check = filters.contexts.indexOf(key) === -1 ? false : true;
            item  = this._new_filter_item(check, key, value, false, this.context_filters_box);
            this.context_filters_box.add_child(item.actor);
            this.filter_register.contexts.push(item);
        }


        this._add_separator(this.project_filters_box);


        //
        // projects
        //
        for ([key, value] of this.delegate.stats.projects.entries()) {
            check = filters.projects.indexOf(key) === -1 ? false : true;
            item  = this._new_filter_item(check, key, value, false, this.project_filters_box);
            this.project_filters_box.add_child(item.actor);
            this.filter_register.projects.push(item);
        }


        //
        // hide the sections that don't have any items
        //
        [
            this.priority_filters_box,
            this.context_filters_box,
            this.project_filters_box,
        ].forEach((it) => it.get_n_children() === 1 && it.hide());
    },

    _reset_all: function () {
        for (let items in this.filter_register) {
            if (! this.filter_register.hasOwnProperty(items)) continue;

            items = this.filter_register[items];

            for (let i = 0, len = items.length; i < len; i++)
                items[i].checkbox.actor.checked = false;
        }
    },

    _new_filter_item: function (is_checked, label, count, is_deletable, parent_box) {
        let item = {};

        item.actor = new St.BoxLayout({ reactive: true, style_class: 'filter-window-item' });

        item.filter = label;

        item.label = new St.Label({ text: label, y_align: Clutter.ActorAlign.CENTER });
        item.actor.add(item.label, {expand: true});

        if (count) {
            item.count_label = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' });
            item.actor.add_child(item.count_label);
            item.count_label.text =
                ngettext('%d task', '%d tasks', count).format(count) + '   ';
        }

        item.checkbox = new CheckBox.CheckBox();
        item.actor.add_actor(item.checkbox.actor);
        item.checkbox.actor.checked = is_checked;


        let close_button;

        if (is_deletable) {
            close_button = new St.Button({ can_focus: true, style_class: 'close-icon' });
            item.actor.add_actor(close_button);

            let close_icon = new St.Icon({ icon_name: 'timepp-close-symbolic' });
            close_button.add_actor(close_icon);

            close_button.connect('clicked', () => {
                this._delete_custom_item(item);
            });
        }

        let actor_to_connect = is_deletable ? close_button : item.checkbox.actor;

        actor_to_connect.connect('key-focus-in', () => {
            SCROLL_TO_ITEM.scroll(this.filter_sectors_scroll,
                                  this.filter_sectors_scroll_box,
                                  parent_box);
        });

        return item;
    },

    _delete_custom_item: function (item) {
        if (item.checkbox.actor.has_key_focus || close_button.has_key_focus)
            this.entry.entry.grab_key_focus();

        item.actor.destroy();

        for (let i = 0; i < this.filter_register.custom.length; i++) {
            if (this.filter_register.custom[i] === item) {
                this.filter_register.custom.splice(i, 1);
                return;
            }
        }
    },

    _add_separator: function (container) {
        let sep = new PopupMenu.PopupSeparatorMenuItem();
        sep.actor.add_style_class_name('timepp-separator');
        container.add_child(sep.actor);
    },

    _on_ok_clicked: function () {
        let filters = {
            invert_filters : this.invert_toggle.state,
            recurring      : this.show_recurring_tasks_toggle.state,
            hidden         : this.show_hidden_tasks_toggle.state,

            completed      : Boolean(this.filter_register.completed &&
                         this.filter_register.completed.checkbox.actor.checked),

            no_priority    : Boolean(this.filter_register.no_priority &&
                       this.filter_register.no_priority.checkbox.actor.checked),

            priorities     : [],
            contexts       : [],
            projects       : [],
            custom         : [],
            custom_active  : [],
        };

        for (let i = 0; i < this.filter_register.priorities.length; i++) {
            let it = this.filter_register.priorities[i];
            if (it.checkbox.actor.checked) filters.priorities.push(it.filter);
        }

        for (let i = 0; i < this.filter_register.contexts.length; i++) {
            let it = this.filter_register.contexts[i];
            if (it.checkbox.actor.checked) filters.contexts.push(it.filter);
        }

        for (let i = 0; i < this.filter_register.projects.length; i++) {
            let it = this.filter_register.projects[i];
            if (it.checkbox.actor.checked) filters.projects.push(it.filter);
        }

        for (let i = 0; i < this.filter_register.custom.length; i++) {
            let it = this.filter_register.custom[i];
            if (it.checkbox.actor.checked) filters.custom_active.push(it.filter);
        }

        for (let i = 0, len = this.filter_register.custom.length; i < len; i++) {
            filters.custom.push(this.filter_register.custom[i].filter);
        }

        this.emit('filters-updated', filters);
    },
});
Signals.addSignalMethods(TaskFiltersWindow.prototype);



// =====================================================================
// @@@ File Switcher
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//   - 'switch' (returns the unique name of the new todo file)
//   - 'close'
// =====================================================================
const TodoFileSwitcher = new Lang.Class({
    Name: 'Timepp.TodoFileSwitcher',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.todo_files   = delegate.settings.get_value('todo-files')
                             .deep_unpack();
        this.current_name = delegate.settings.get_value('todo-current')
                             .deep_unpack().name;

        this.file_items    = []; // the ones created with _load_items()
        this.selected_item = null;


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box todo-switcher-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // search entry
        //
        let entry_container = new St.BoxLayout({ vertical: true, x_expand: true, style_class: 'row' });
        this.content_box.add_child(entry_container);

        this.entry = new MULTIL_ENTRY.MultiLineEntry(_('Search files...'), false, true);
        entry_container.add_child(this.entry.actor);


        //
        // todo file items
        //
        this.items_scroll = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(this.items_scroll);

        this.items_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.items_scroll.hscrollbar_policy = Gtk.PolicyType.NEVER;

        this.items_scroll_content = new St.BoxLayout({ vertical: true });
        this.items_scroll.add_actor(this.items_scroll_content);

        this._load_items();


        //
        // listen
        //
        this.delegate.settings.connect('changed::todo-files', () => {
            this.emit('close');
        });
        this.entry.entry.clutter_text.connect('text-changed', () => {
            this._search_files();
        });
        this.entry.entry.clutter_text.connect('activate', () => {
            if (this.selected_item &&
                this.selected_item.name !== this.current_name) {

                this.emit('switch', this.selected_item.name);
            }
            else {
                this.emit('close');
            }
        });
        this.items_scroll_content.connect('queue-redraw', () => {
            this.items_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
            if (ext.needs_scrollbar())
                this.items_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
        });
    },

    _load_items: function () {
        let it, item, is_current, current_item;

        for (let i = 0, len = this.todo_files.length; i < len; i++) {
            it = this.todo_files[i];
            is_current = (it.name === this.current_name);

            item = {};

            item.name = it.name;

            item.actor = new St.Button({ can_focus: true, reactive: true, x_fill: true, x_align: St.Align.START, track_hover: true, style_class: 'row popup-menu-item' });
            item.actor._delegate = item;

            let content = new St.BoxLayout();
            item.actor.add_actor(content);

            item.label = new St.Label ({ text: it.name, x_expand: true });
            content.add_child(item.label);

            if (is_current) {
                current_item = item;
                content.add_child(new St.Label({ text: _('current file'), margin_left: 8, style_class: 'popup-inactive-menu-item', pseudo_class: 'insensitive' }));
            }
            else {
                this.items_scroll_content.add_child(item.actor);
                this.file_items.push(item);
            }

            item.actor.connect('notify::hover', (item) => {
                item.grab_key_focus();
            });
            item.actor.connect('key-focus-in', (item) => {
                if (this.selected_item)
                    this.selected_item.actor.pseudo_class = '';

                this.selected_item = item._delegate;
                item.pseudo_class  = 'active';

                SCROLL_TO_ITEM.scroll(this.items_scroll,
                                      this.items_scroll_content,
                                      item);
            });
            item.actor.connect('clicked', (item) => {
                if (item._delegate.name !== this.current_name)
                    this.emit('switch', item._delegate.name);
                else
                    this.emit('close');
            });
        }

        this.items_scroll_content.insert_child_at_index(current_item.actor, 0);
        this.file_items.unshift(current_item);

        this.selected_item              = current_item;
        current_item.actor.pseudo_class = 'active';
    },

    _search_files: function () {
        let needle = this.entry.entry.get_text();
        let len    = this.file_items.length;

        if (!needle) {
            this.items_scroll_content.remove_all_children();

            for (let i = 0; i < len; i++) {
                this.items_scroll_content.add_child(this.file_items[i].actor);
            }
        }
        else {
            let reduced_results = [];
            let i, item, score;

            for (i = 0; i < len; i++) {
                item = this.file_items[i];

                score = FUZZ.fuzzy_search_v1(needle, item.label.text);
                if (!score) continue;
                reduced_results.push([score, item]);
            }

            reduced_results.sort((a, b) => a[0] < b[0]);

            this.items_scroll_content.remove_all_children();

            for (i = 0, len = reduced_results.length; i < len; i++) {
                this.items_scroll_content.add_child(reduced_results[i][1].actor);
            }
        }

        if (this.selected_item) this.selected_item.actor.pseudo_class = '';

        let first_child = this.items_scroll_content.get_first_child();

        if (first_child) {
            this.selected_item       = first_child._delegate;
            first_child.pseudo_class = 'active';
        }
        else {
            this.selected_item = null;
        }
    },
});
Signals.addSignalMethods(TodoFileSwitcher.prototype);



// =====================================================================
// @@@ Sort UI
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals: 'update-sort'
// =====================================================================
const TaskSortWindow = new Lang.Class({
    Name: 'Timepp.TaskSortWindow',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.checked_sort_item  = null;
        this.dnd_pos            = null;
        this.dnd_placeholder    = null

        this.sort_text_map = {
            [SortType.CONTEXT]         : _('Sort by Context'),
            [SortType.PROJECT]         : _('Sort by Projects'),
            [SortType.PRIORITY]        : _('Sort by Priority'),
            [SortType.DUE_DATE]        : _('Sort by Due Date'),
            [SortType.COMPLETED]       : _('Sort by Completed'),
            [SortType.CREATION_DATE]   : _('Sort by Creation Date'),
            [SortType.COMPLETION_DATE] : _('Sort by Completion Date'),
        }


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box sort-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);

        this.sort_items_box = new St.BoxLayout({ vertical: true, style_class: 'sort-items-box' });
        this.content_box.add_child(this.sort_items_box);
        this.sort_items_box._delegate = this;


        //
        // create sort items
        //
        for (let i = 0; i < this.delegate.cache.sort.length; i++) {
            let it = this.delegate.cache.sort[i];
            this._new_sort_type_item(it[0], it[1]);
        }


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(this.btn_box);
        this.button_ok = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button' });
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.button_ok.connect('clicked', () => {
            this._on_ok_clicked();
        });
    },

    _on_ok_clicked: function () {
        let res      = [];
        let children = this.sort_items_box.get_children();

        for (let i = 0; i < children.length; i++) {
            let it = children[i]._delegate;
            res.push([it.sort_type, it.sort_order]);
        }

        this.emit('update-sort', res);
    },

    _new_sort_type_item: function (sort_type, sort_order) {
        let item = {};

        item.sort_type  = sort_type;
        item.sort_order = sort_order;

        item.actor = new St.BoxLayout({ reactive: true, style_class: 'row' });
        item.actor._delegate = item;
        item._delegate = this.sort_items_box;
        this.sort_items_box.add_child(item.actor);

        item.label = new St.Label ({ text: this.sort_text_map[sort_type], reactive: true, y_align: Clutter.ActorAlign.CENTER });
        item.actor.add(item.label, {expand: true});

        item.icn_box = new St.BoxLayout({ style_class: 'icon-box' });
        item.actor.add_actor(item.icn_box);

        item.sort_btn = new St.Button({ reactive: true, can_focus: true });
        item.icn_box.add_actor(item.sort_btn);

        item.sort_icon = new St.Icon();
        item.sort_btn.add_actor(item.sort_icon);

        item.sort_icon.set_icon_name(
            sort_order === SortOrder.ASCENDING ?
            'timepp-sort-ascending-symbolic'   :
            'timepp-sort-descending-symbolic'
        );


        // DND
        // Note that the various funcs that are being called from within
        // item._draggable rely on the '_delegate' property, so make sure that
        // the relevant actors have those, since we don't usually use the
        // '_delegate' pattern heavily in this extension.
        item._draggable = DND.makeDraggable(item.actor, { restoreOnSuccess: false, manualMode: false, dragActorOpacity: 0 });


        //
        // listen
        //
        item._draggable.connect('drag-begin', () => {
            if (! this.dnd_placeholder) {
                this.dnd_placeholder = new St.Bin();
                this.dnd_placeholder._delegate = this.sort_items_box;
                this.dnd_placeholder.set_width (item.actor.width);
                this.dnd_placeholder.set_height (item.actor.height);

                let i        = 0;
                let children = this.sort_items_box.get_children();

                for (; i < children.length; i++)
                    if (children[i] === item.actor) break;

                this.sort_items_box.insert_child_at_index(
                    this.dnd_placeholder, i);
            }
        });

        item._draggable.connect('drag-end', () => {
            item.actor.opacity = 255;

            if (this.dnd_placeholder) {
                this.dnd_placeholder.destroy();
                this.dnd_placeholder = null;
                this.dnd_pos         = null;
            }
        });

        item.sort_btn.connect('key-press-event', (_, event) => {
            if (event.get_state() !== Clutter.ModifierType.CONTROL_MASK)
                return Clutter.EVENT_PROPAGATE;

            let i        = 0;
            let children = this.sort_items_box.get_children();

            for (; i < children.length; i++)
                if (children[i] === item.actor) break;

            if (event.get_key_symbol() === Clutter.KEY_Up && i > 0) {
                this.sort_items_box.set_child_at_index(item.actor, --i);
                return Clutter.EVENT_STOP;
            }
            else if (event.get_key_symbol() === Clutter.KEY_Down &&
                     i < children.length - 1) {

                this.sort_items_box.set_child_at_index(item.actor, ++i);
                return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        });

        item.sort_btn.connect('clicked', () => {
            if (item.sort_order === SortOrder.ASCENDING) {
                item.sort_order = SortOrder.DESCENDING;
                item.sort_icon.icon_name = 'timepp-sort-descending-symbolic';
            }
            else {
                item.sort_order = SortOrder.ASCENDING;
                item.sort_icon.icon_name = 'timepp-sort-ascending-symbolic';
            }
        });

        item.label.connect('enter-event', () => {
            global.screen.set_cursor(Meta.Cursor.DND_UNSUPPORTED_TARGET);
        });

        item.label.connect('leave-event', () => {
            global.screen.set_cursor(Meta.Cursor.DEFAULT);
        });
    },

    // Called from within item._draggable.
    handleDragOver: function (source, actor, x, y, time) {
        if (source._delegate !== this.sort_items_box)
            return DND.DragMotionResult.NO_DROP;

        let children = this.sort_items_box.get_children();
        let pos      = children.length;

        while (--pos && y < children[pos].get_allocation_box().y1);

        this.dnd_pos = pos;

        this.sort_items_box.set_child_at_index(this.dnd_placeholder, this.dnd_pos);

        return DND.DragMotionResult.MOVE_DROP;
    },

    // Called from within item._draggable.
    acceptDrop: function (source, actor, x, y, time) {
        if (source._delegate !== this.sort_items_box || this.dnd_pos === null)
            return false;

        Main.uiGroup.remove_child(source.actor);
        this.sort_items_box.insert_child_at_index(source.actor, this.dnd_pos);

        return true;
    },
});
Signals.addSignalMethods(TaskSortWindow.prototype);



// =====================================================================
// @@@ Clear window.
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// @signals:
//   - 'delete-all'  (delete all completed tasks)
//   - 'archive-all' (delete and write to done.txt all completed tasks)
//   - 'cancel'
// =====================================================================
const ClearCompletedTasks = new Lang.Class({
    Name: 'Timepp.ClearCompletedTasks',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;


        //
        // draw
        //
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box clear-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);


        //
        // options
        //
        this.delete_all_item = new St.BoxLayout({ reactive: true, style_class: 'row' });
        this.content_box.add_child(this.delete_all_item);

        this.delete_all_label = new St.Label ({ text: _('Delete all completed tasks'), y_align: Clutter.ActorAlign.CENTER, style_class: 'delete-completed-tasks-label' });
        this.delete_all_item.add(this.delete_all_label, {expand: true});

        this.delete_all_radiobutton = new St.Button({ style_class: 'radiobutton', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
        this.delete_all_item.add_child(this.delete_all_radiobutton);

        let delete_all_checkmark = new St.Bin();
        this.delete_all_radiobutton.add_actor(delete_all_checkmark);


        this.archive_all_item = new St.BoxLayout({ reactive: true, style_class: 'row' });
        this.content_box.add_child(this.archive_all_item);

        this.archive_all_label = new St.Label ({ text: _('Archive all completed tasks to done.txt and delete them'), y_align: Clutter.ActorAlign.CENTER, style_class: 'archive-all-completed-tasks-label' });
        this.archive_all_item.add(this.archive_all_label, {expand: true});

        this.archive_all_radiobutton = new St.Button({ style_class: 'radiobutton', toggle_mode: true, can_focus: true, y_align: St.Align.MIDDLE });
        this.archive_all_item.add_child(this.archive_all_radiobutton);

        let archive_all_checkmark = new St.Bin();
        this.archive_all_radiobutton.add_actor(archive_all_checkmark);

        let done_file = this.delegate.settings.get_value('todo-current')
                            .deep_unpack().done_file;

        if (!done_file) {
            this.archive_all_item.hide();
            this.delete_all_radiobutton.checked = true;
        }
        else {
            this.archive_all_radiobutton.checked = true;
        }


        //
        // buttons
        //
        this.btn_box = new St.BoxLayout({ x_expand: true, style_class: 'row btn-box' });
        this.content_box.add_child(this.btn_box);

        this.button_cancel = new St.Button({ can_focus: true, label: _('Cancel'), style_class: 'btn-cancel button notification-icon-button modal-dialog-button' });
        this.btn_box.add(this.button_cancel, {expand: true});

        this.button_ok = new St.Button({ can_focus: true, label: _('Ok'), style_class: 'btn-ok button notification-icon-button modal-dialog-button' });
        this.btn_box.add(this.button_ok, {expand: true});


        //
        // listen
        //
        this.archive_all_radiobutton.connect('clicked', () => {
            this.delete_all_radiobutton.checked = false;
        });
        this.delete_all_radiobutton.connect('clicked', () => {
            let done_file = this.delegate.settings.get_value('todo-current')
                                .deep_unpack().done_file;

            if (!done_file) {
                this.delete_all_radiobutton.checked = true;
                return;
            }

            this.archive_all_radiobutton.checked = false;
        });
        this.button_ok.connect('clicked',  () => {
            if (this.delete_all_radiobutton.checked)
                this.emit('delete-all');
            else
                this.emit('archive-all');
        });
        this.button_cancel.connect('clicked', () => { this.emit('cancel'); });
    },
});
Signals.addSignalMethods(ClearCompletedTasks.prototype);



// =====================================================================
// @@@ Stats UI
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// @stats    : null or array (of stats object produced by TimeTracker.get_stats)
//
// @stats === null means that the records for a task/project weren't found.
// =====================================================================
const TimeTrackerStatView = new Lang.Class({
    Name: 'Timepp.TimeTrackerStatView',

    _init: function (ext, delegate, stats) {
        this.actor = new St.Bin({ x_fill: true, style_class: 'view-box stats-window' });

        this.content_box = new St.BoxLayout({ x_expand: true, vertical: true, style_class: 'view-box-content' });
        this.actor.add_actor(this.content_box);

        this.close_button = new St.Button({ can_focus: true, style_class: 'close-icon', x_expand: true, x_align: St.Align.END });
        this.content_box.add_actor(this.close_button);

        let close_icon = new St.Icon({ icon_name: 'timepp-close-symbolic' });
        this.close_button.add_actor(close_icon);

        this.close_button.connect('clicked', () => { this.emit('close'); });

        let scroll_view = new St.ScrollView({ style_class: 'vfade' });
        this.content_box.add_actor(scroll_view);

        // enable scrolling by grabbing with the mouse
        scroll_view.vscroll.connect('scroll-start', () => { ext.menu.passEvents = true; });
        scroll_view.vscroll.connect('scroll-stop', () => { ext.menu.passEvents = false; });

        let scroll_content = new St.BoxLayout({ vertical: true });
        scroll_view.add_actor(scroll_content);

        if (! stats) {
            let label = new St.Label({ text : _('Nothing found...'), style: 'font-weight: bold;', style_class: 'row' });
            scroll_content.add_child(label);

            return;
        }

        let it, markup = '';
        let titles = this._gen_titles();

        for (let i = 0, len = stats.length; i < len; i++) {
            it = stats[i];

            markup +=
                '<b>' + it.name + '</b>:'                             + '\n\n' +
                '    ' + titles[0] + this._format(it.today)           + '\n' +
                '    ' + titles[1] + this._format(it.last_three_days) + '\n' +
                '    ' + titles[2] + this._format(it.this_week)       + '\n' +
                '    ' + titles[3] + this._format(it.this_month)      + '\n' +
                '    ' + titles[4] + this._format(it.this_year);

            if (i !== len - 1 && len > 1) markup += '\n\n\n\n';
        }

        let text = new St.Label({ text: it.name, style_class: 'stats-item-title popup-menu-item' });
        scroll_content.add_actor(text);

        text.clutter_text.line_wrap      = true;
        text.clutter_text.ellipsize      = Pango.EllipsizeMode.NONE;
        text.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        text.clutter_text.set_markup('<tt>' + markup + '</tt>');
    },

    _gen_titles: function () {
        let titles = [
            '<b>'+_('today')+'</b>',
            '<b>'+_('last 3 days')+'</b>',
            '<b>'+_('this week')+'</b>',
            '<b>'+_('this month')+'</b>',
            '<b>'+_('this year')+'</b>',
        ];

        let longest = titles[0].length;

        for (let i = 1; i < titles.length; i++) {
            longest = (titles[i].length > longest) ? titles[i].length : longest;
        }

        longest += 2;

        for (let i = 0; i < titles.length; i++) {
            let diff  = longest - titles[i].length;
            titles[i] = titles[i] + Array(diff).join(' ') + ':  ';
        }

        return titles;
    },

    _format: function (seconds) {
        return '' + Math.floor(seconds / 3600)      + 'h ' +
                    Math.round(seconds % 3600 / 60) + 'm';
    },
});
Signals.addSignalMethods(TimeTrackerStatView.prototype);



// =====================================================================
// @@@ Time tracker
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
// =====================================================================
const TimeTracker = new Lang.Class({
    Name: 'Timepp.TimeTracker',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.dbus_impl = Gio.DBusExportedObject.wrapJSObject(TIME_TRACKER_DBUS_IFACE, this);
        this.dbus_impl.export(Gio.DBus.session, '/timepp/zagortenay333/TimeTracker');

        this.csv_dir = delegate.settings.get_value('todo-current')
                       .deep_unpack().csv_dir;

        if (this.csv_dir) {
            try {
                [this.csv_dir, ] = GLib.filename_from_uri(this.csv_dir, null);
            } catch (e) { logError(e); }
        }

        this.timer_seconds_mainloop_id            = null;
        this.timer_minutes_mainloop_id            = null;
        this.number_of_tracked_tasks              = 0;
        this.yearly_csv_file_monitor              = null;
        this.daily_csv_file_monitor               = null;
        this.daily_csv_file_monitor_handler_block = false;


        // We only read the yearly csv file for statistics lookup.
        // The daily csv file is appended to it each day.
        //
        // The structure of the yearly map is:
        //
        // @key : string
        // @val : array
        //
        // @key:
        //   is a string which is either a task string (a single line in the
        //   todo.txt file) or a project keyword (e.g., '+my_project', '+stuff',
        //   etc...)
        //
        // @val:
        //   is an object of the form: { type    : string,
        //                               records : array, }
        //
        //   @type
        //     is either the string '++' or the string '()'.
        //     '++' means it's a project, '()' means it's a task.
        //
        //   @records
        //     is an array of objects where each object is of the form:
        //     {date: string (in yyyy-mm-dd format), time: int (seconds)}
        //     E.g., {date: '3434-34-34', time: 324}
        this.yearly_csv_map = new Map();


        // The structure of the daily map is:
        //
        // @key:
        //   is a string which is either a task string (a single line in the
        //   todo.txt file) or a project keyword (e.g., '+my_project', '+stuff',
        //   etc...)
        //
        // @val:
        //   is an object of the form: { time     : int,
        //                               tracking : bool,
        //                               type     : string, }
        //
        //   If the type is '++' (a project), then the @val obj will have the
        //   additional property: tracked_children (int).
        //
        //   If the type is '()' (a task), then the @val object will have the
        //   additional property: task_ref (obj).
        //
        //   @time     : time tracked in seconds.
        //   @tracking : indicates whether the entry is being tracked.
        //   @type     : indicates whether the entry is a project or task.
        //
        //   @task_ref         : the ref of the corresponding task object.
        //   @tracked_children : number of tasks that are part of this project
        //                       and that are being tracked.
        this.daily_csv_map = new Map();


        //
        // init csv dir
        // We init the daily/yearly csv maps with the this func as well.
        //
        this._init_tracker_dir();


        //
        // listen
        //
        this.delegate.connect('new-day', () => {
            this._archive_daily_csv_file();
        });
        this.ext.connect('stop-time-tracking', () => {
            this.stop_all_tracking();
        });
        delegate.settings.connect('changed::todo-current', () => {
            this.csv_dir = delegate.settings.get_value('todo-current')
                           .deep_unpack().csv_dir;

            if (this.csv_dir) {
                try {
                    [this.csv_dir, ] = GLib.filename_from_uri(this.csv_dir, null);
                } catch (e) { logError(e); }
            }

            this._init_tracker_dir();
        });
    },

    _timer_seconds: function () {
        if (this.number_of_tracked_tasks === 0) {
            this.timer_seconds_mainloop_id = null;
            return;
        }

        for (let [, v] of this.daily_csv_map.entries()) {
            if (v.tracking) v.time++;
        }

        this.timer_seconds_mainloop_id = Mainloop.timeout_add_seconds(1, () => {
            this._timer_seconds();
        });
    },

    _timer_minutes: function () {
        if (this.number_of_tracked_tasks === 0) {
            this.timer_minutes_mainloop_id = null;
            return;
        }

        this.timer_minutes_mainloop_id = Mainloop.timeout_add_seconds(60, () => {
            this._write_daily_csv_file();
            this._timer_minutes();
        });
    },

    _start_timers: function () {
        if (! this.timer_seconds_mainloop_id) this._timer_seconds();
        if (! this.timer_minutes_mainloop_id) this._timer_minutes();
    },

    _stop_timers: function () {
        if (this.timer_seconds_mainloop_id) {
            Mainloop.source_remove(this.timer_seconds_mainloop_id);
            this.timer_seconds_mainloop_id = null;
        }

        if (this.timer_minutes_mainloop_id) {
            Mainloop.source_remove(this.timer_minutes_mainloop_id);
            this.timer_minutes_mainloop_id = null;
        }
    },

    _init_tracker_dir: function () {
        // reset
        this.stop_all_tracking();
        this._stop_timers();

        if (this.daily_csv_file_monitor) {
            this.daily_csv_file_monitor.cancel();
            this.daily_csv_file_monitor = null;
        }

        if (this.yearly_csv_file_monitor) {
            this.yearly_csv_file_monitor.cancel();
            this.yearly_csv_file_monitor = null;
        }


        if (! this.csv_dir) return;


        // ensure tracker dir
        Util.spawnCommandLine("mkdir -p  %s".format(this.csv_dir));


        // Archive the yearly csv file each year
        let today  = new Date();
        let prev_f = this.csv_dir + '/' +
                     (today.getFullYear() - 1) + '__time_tracker.csv';

        if (today.getMonth() === 0 &&
            today.getDate()  === 1 &&
            GLib.file_test(prev_f, GLib.FileTest.EXISTS)) {

            let dir = this.csv_dir + "/YEARS__time_tracker";
            Util.spawnCommandLine("mkdir -p  %s".format(dir));
            Util.spawnCommandLine("mv %s %s".format(prev_f, dir));
        }

        // init daily and yearly csv map
        this._init_yearly_csv_map();
        this._init_daily_csv_map();
    },

    _init_yearly_csv_map: function () {
        this.yearly_csv_file = null;
        this.yearly_csv_map.clear();

        if (this.yearly_csv_file_monitor) {
            this.yearly_csv_file_monitor.cancel();
            this.yearly_csv_file_monitor = null;
        }


        if (! this.csv_dir) return;


        // ensure tracker dir
        Util.spawnCommandLine("mkdir -p  %s".format(this.csv_dir));

        try {
            Util.spawnCommandLine("mkdir -p  %s".format(this.csv_dir));

            this.yearly_csv_file = Gio.file_new_for_path(
                this.csv_dir +
                '/' + (new Date().getFullYear()) + '__time_tracker.csv');

            if (!this.yearly_csv_file || !this.yearly_csv_file.query_exists(null))
                this.yearly_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.yearly_csv_file_monitor = this.yearly_csv_file.monitor_file(
                Gio.FileMonitorFlags.NONE, null);

            this.yearly_csv_file_monitor.connect('changed', () => {
                this._on_yearly_csv_file_changed();
            });
        }
        catch (e) { logError(e); }


        let [, contents] = this.yearly_csv_file.load_contents(null);
        contents = String(contents).trim().split(/\n|\r/);


        let it, val, record, key;

        for (let i = 0, len = contents.length; i < len; i++) {
            it = contents[i].trim();

            if (it === '') continue;

            key    = it.substring(24, it.length - 1).replace(/""/g, '"');
            val    = this.yearly_csv_map.get(key);
            record = {
                date : it.substr(0, 10),
                time : +(it.substr(12, 2)) * 3600 + (+(it.substr(15, 2)) * 60),
            };

            if (val)
                val.records.push(record);
            else
                this.yearly_csv_map.set(key, {
                    type    : it.substr(19, 2),
                    records : [record],
                });
        }
    },

    _init_daily_csv_map: function () {
        this.daily_csv_file = null;
        this.daily_csv_map.clear();

        if (this.daily_csv_file_monitor) {
            this.daily_csv_file_monitor.cancel();
            this.daily_csv_file_monitor = null;
        }


        if (! this.csv_dir) return;


        // ensure tracker dir
        Util.spawnCommandLine("mkdir -p  %s".format(this.csv_dir));

        try {
            Util.spawnCommandLine("mkdir -p  %s".format(this.csv_dir));

            this.daily_csv_file = Gio.file_new_for_path(
                this.csv_dir + '/TODAY__time_tracker.csv');

            if (!this.daily_csv_file || !this.daily_csv_file.query_exists(null))
                this.daily_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.daily_csv_file_monitor = this.daily_csv_file.monitor_file(
                Gio.FileMonitorFlags.NONE, null);

            this.daily_csv_file_monitor.connect('changed', () => {
                this._on_daily_csv_file_changed();
            });
        }
        catch (e) { logError(e); }


        let [, contents] = this.daily_csv_file.load_contents(null);
        contents = String(contents).trim().split(/\n|\r/);

        // Check if the todays csv file is out of date and archive it instead.
        for (let i = 0, len = contents.length; i < len; i++) {
            if (contents[i] === '') continue;

            if (contents[i].substr(0, 10) !== date_yyyymmdd()) {
                this._archive_daily_csv_file();
                return;
            }
        }

        let it, key, type;

        for (let i = 0, len = contents.length; i < len; i++) {
            it = contents[i].trim();

            if (it === '') continue;

            key  = it.substring(24, it.length - 1).replace(/""/g, '"');
            type = it.substr(19, 2);

            this.daily_csv_map.set(key, {
                time : +(it.substr(12, 2)) * 3600 + (+(it.substr(15, 2)) * 60),
                tracking : false,
                type     : type,
            });

            if (type === '++') this.daily_csv_map.get(key).tracked_children = 0;
            else               this.daily_csv_map.get(key).task_ref = null;
        }
    },

    _on_yearly_csv_file_changed: function () {
        this._init_yearly_csv_map();
    },

    _on_daily_csv_file_changed: function () {
        // @HACK
        // The normal handler_block/unblock methods don't work with a file
        // monitor for some reason. This seems to work well enough.
        if (this.daily_csv_file_monitor_handler_block) {
            Mainloop.idle_add(() => {
                this.daily_csv_file_monitor_handler_block = false;
            });
            return;
        }

        this.stop_all_tracking();
        this._init_daily_csv_map();
    },

    _write_daily_csv_file: function () {
        this.daily_csv_file_monitor_handler_block = true;

        let projects = '';
        let tasks    = '';
        let line, hh, mm;

        for (let [k, v] of this.daily_csv_map.entries()) {
            if (v.time < 60) continue;

            hh = '' + Math.floor(v.time / 3600);
            hh = (hh.length === 1) ? ('0' + hh) : hh;

            mm = '' + Math.round(v.time % 3600 / 60);
            mm = (mm.length === 1) ? ('0' + mm) : mm;

            line = '' + date_yyyymmdd() + ', ' +
                       hh + ':' + mm    + ', ' +
                       v.type           + ', ' +
                       '"' + k.replace(/"/g, '""') + '"' + '\n';

            if (v.type === '++') projects += line;
            else                 tasks    += line;
        }

        try {
            if (!this.daily_csv_file || !this.daily_csv_file.query_exists(null))
                this.daily_csv_file.create(Gio.FileCreateFlags.NONE, null);

            this.daily_csv_file.replace_contents(projects + tasks, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        }
        catch (e) { logError(e); }
    },

    _archive_daily_csv_file: function () {
        let [, contents]  = this.daily_csv_file.load_contents(null);

        let append_stream = this.yearly_csv_file.append_to(
            Gio.FileCreateFlags.NONE, null);

        append_stream.write_all(contents, null);

        this.daily_csv_file.replace_contents('', null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        for (let [, v] of this.daily_csv_map.entries()) {
            v.date = date_yyyymmdd();
            v.time = 0;
        }
    },

    _get_week_start_date: function () {
        let d       = new Date();
        let day_pos = (7 - Shell.util_get_week_start() + d.getDay()) % 7;

        d.setDate(d.getDate() - day_pos + 1);

        return d.toISOString().substr(0, 10);
    },

    stop_all_tracking: function () {
        if (!this.csv_dir) return;

        this.number_of_tracked_tasks = 0;

        for (let [k, v] of this.daily_csv_map.entries()) {
            if (v.tracking) {
                v.tracking = false;
                if (v.type === '()') v.task_ref.on_tracker_stopped();
            }
        }

        this.delegate.panel_item.actor.remove_style_class_name('on');
    },

    toggle_tracking: function (task) {
        let val = this.daily_csv_map.get(task.task_str);

        if (val && val.tracking) this.stop_tracking(task);
        else                     this.start_tracking(task);
    },

    start_tracking_by_id: function (id) {
        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].tracker_id === id) {
                this.start_tracking(this.delegate.tasks[i]);
            }
        }
    },

    stop_tracking_by_id: function (id) {
        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].tracker_id === id) {
                this.stop_tracking(this.delegate.tasks[i]);
            }
        }
    },

    start_tracking: function (task) {
        if (!this.csv_dir) {
            Main.notify(_('To track time, select a dir for csv files in the settings.'));
            return null;
        }

        let val = this.daily_csv_map.get(task.task_str);

        if (val && val.tracking) return;

        if (val) {
            val.tracking = true;
            val.task_ref = task;
        }
        else {
            this.daily_csv_map.set(task.task_str, {
                time     : 0,
                tracking : true,
                type     : '()',
                task_ref : task,
            });
        }

        if (task.projects) {
            for (let i = 0, len = task.projects.length; i < len; i++) {
                val = this.daily_csv_map.get(task.projects[i]);

                if (val) {
                    val.tracking = true;
                    val.tracked_children++;
                }
                else {
                    this.daily_csv_map.set(task.projects[i], {
                        time             : 0,
                        tracking         : true,
                        type             : '++',
                        tracked_children : 1,
                    });
                }
            }
        }

        this.number_of_tracked_tasks++;
        this._start_timers();

        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].task_str === task.task_str)
                this.delegate.tasks[i].on_tracker_started();
        }

        this.delegate.panel_item.actor.add_style_class_name('on');
    },

    stop_tracking: function (task) {
        if (!this.csv_dir) return null;

        let val = this.daily_csv_map.get(task.task_str);

        if (!val || !val.tracking) return;

        val.tracking = false;
        this.number_of_tracked_tasks--;

        if (task.projects) {
            let proj;

            for (let i = 0, len = task.projects.length; i < len; i++) {
                proj = this.daily_csv_map.get(task.projects[i]);
                if (--proj.tracked_children === 0) proj.tracking = false;
            }
        }

        for (let i = 0, len = this.delegate.tasks.length; i < len; i++) {
            if (this.delegate.tasks[i].task_str === task.task_str)
                this.delegate.tasks[i].on_tracker_stopped();
        }

        if (this.number_of_tracked_tasks === 0)
            this.delegate.panel_item.actor.remove_style_class_name('on');
    },

    // Swap the old_task_str with the new_task_str in the daily_csv_map only.
    update_record_name: function (old_task_str, new_task_str) {
        if (!this.csv_dir) return null;

        let val = this.daily_csv_map.get(old_task_str);

        if (! val) return;

        this.daily_csv_map.set(new_task_str, val);
        this.daily_csv_map.delete(old_task_str);

        this._write_daily_csv_file();
    },

    get_all_project_stats: function () {
        if (!this.csv_dir) return null;

        let stats = [];

        for (let [k, v] of this.yearly_csv_map.entries())
            if (v.type === '++')
                stats.push(this.get_stats(k));

        if (stats.length === 0) stats = null;

        return stats;
    },

    // @needle: string (a task_str or a project keyword)
    get_stats: function (needle) {
        if (!this.csv_dir) return null;

        let yearly_records = this.yearly_csv_map.get(needle);
        yearly_records     = yearly_records ? yearly_records.records : null;

        let todays_record  = this.daily_csv_map.get(needle);
        todays_record      = todays_record ? todays_record.time : 0;

        if (! yearly_records && ! todays_record) return null;

        let stats = {
            name            : needle,
            today           : todays_record,
            last_three_days : todays_record,
            this_week       : todays_record,
            this_month      : todays_record,
            this_year       : todays_record,
        };

        if (! yearly_records) return stats;

        let dates = [
            ['last_three_days', new Date(Date.now() - 172800000).toISOString().substr(0, 10)],
            ['this_week',       this._get_week_start_date()],
            ['this_month',      new Date().toISOString().substr(0, 8) + '01'],
            ['this_year',       new Date().getFullYear() + '-01-01'],
        ];

        let acc = todays_record;
        let i   = yearly_records.length;
        let j, it;

        while (i--) {
            it   = yearly_records[i];
            acc += it.time;

            j = dates.length;

            while (j--) {
                if (dates[j][1] <= it.date) stats[ dates[j][0] ] = acc;
                else dates.splice(j, 1);
            }
        }

        return stats;
    },

    close: function () {
        this.dbus_impl.unexport();

        if (this.yearly_csv_file_monitor) {
            this.yearly_csv_file_monitor.cancel();
            this.yearly_csv_file_monitor = null;
        }

        if (this.daily_csv_file_monitor) {
            this.daily_csv_file_monitor.cancel();
            this.daily_csv_file_monitor = null;
        }

        if (this.show_tasks_mainloop_id) {
            Mainloop.source_remove(this.show_tasks_mainloop_id);
            this.show_tasks_mainloop_id = null;
        }

        if (this.timer_seconds_mainloop_id) {
            Mainloop.source_remove(this.timer_seconds_mainloop_id);
            this.timer_seconds_mainloop_id = null;
        }

        if (this.timer_minutes_mainloop_id) {
            Mainloop.source_remove(this.timer_minutes_mainloop_id);
            this.timer_minutes_mainloop_id = null;
        }
    },
});
Signals.addSignalMethods(TimeTracker.prototype);



// =====================================================================
// @@@ View Manager
//
// @ext      : obj (main extension object)
// @delegate : obj (main section object)
//
// - The todo section is always in a particular view.
// - A view must be enlisted in the View enum.
// - To switch to a new view, use the show_view function of this object.
// - The current_view is always stored in the current_view var of this obj.
// =====================================================================
const ViewManager = new Lang.Class({
    Name: 'Timepp.ViewManager',

    _init: function (ext, delegate) {
        this.ext      = ext;
        this.delegate = delegate;

        this.current_view           = View.DEFAULT;
        this.actors                 = [];
        this.close_callback         = () => null;
        this.show_tasks_mainloop_id = null;

        // @SPEED
        this.delegate.connect('section-open-state-changed', (_, state) => {
            if (this.current_view === View.LOADING ||
                this.current_view === View.NO_TODO_FILE) {

                return Clutter.EVENT_PROPAGATE;
            }

            if (state) {
                if (this.delegate.tasks_scroll_wrapper.visible)
                    this._show_tasks();
            }
            else if (this.delegate.tasks_scroll_wrapper.visible) {
                this._hide_tasks();
            }

            return Clutter.EVENT_PROPAGATE;
        });
    },

    // @view:
    //   is an object of the form: { view_name      : View,
    //                               actors         : array,
    //                               focused_actors : object,
    //                               close_callback : func, }
    //
    // When calling this function all properties must be provided.
    //
    // @view_name:
    //   is the name of the new view. Only use the View enum here.
    //
    // @actors:
    //   is an array of all the top-level actors that need to be in the popup
    //   menu. These are the actors that make up the particular view.
    //
    // @focused_actor:
    //   is the actor that will be put into focus when the view is shown.
    //
    // @close_callback:
    //   is a function that is used to close this view when another view needs
    //   to be shown.
    show_view: function (view) {
        if (this.delegate.tasks_scroll_wrapper.visible) this._hide_tasks();

        this.delegate.actor.remove_all_children();
        this.close_callback();

        this.current_view   = view.view_name;
        this.actors         = view.actors;
        this.close_callback = view.close_callback;

        let show_tasks = false;

        for (let i = 0; i < this.actors.length; i++) {
            this.delegate.actor.add_actor(this.actors[i]);
            this.actors[i].show();
            if (this.actors[i] === this.delegate.tasks_scroll_wrapper)
                show_tasks = true;
        }

        if (show_tasks) {
            if (this.delegate.tasks.length !== 0) this._show_tasks();
            else this.delegate.tasks_scroll_wrapper.hide();
        }

        if (this.ext.menu.isOpen) view.focused_actor.grab_key_focus();
    },

    // @SPEED
    // Showing/adding actors to the popup menu can be somewhat laggy if there
    // are a lot of tasks. To speed things up a bit, each time we need to add,
    // show, hide, or remove actors from the popup menu, we first hide all
    // tasks, do the operation and then show the tasks again.
    //
    // Also, each time the popup menu closes, we hide the tasks, and show them
    // using this func after the menu opens.
    _show_tasks: function () {
        if (! this.ext.menu.isOpen) return;

        this.delegate.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.NEVER;
        this.delegate.tasks_scroll.get_vscroll_bar().get_adjustment().set_value(0);

        let n = Math.min(this.delegate.tasks_viewport.length, 21);

        for (let i = 0; i < n; i++)
            this.delegate.tasks_viewport[i].actor.visible = true;

        this.show_tasks_mainloop_id = Mainloop.idle_add(() => {
           this._show_tasks__finish(n);
        });
    },

    _show_tasks__finish: function (i, scroll_bar_shown) {
        if (!scroll_bar_shown && this.ext.needs_scrollbar()) {
            this.delegate.tasks_scroll.vscrollbar_policy = Gtk.PolicyType.ALWAYS;
            scroll_bar_shown = true;
        }

        if (! this.ext.menu.isOpen ||
            i === this.delegate.tasks_viewport.length ||
            this.delegate.add_tasks_to_menu_mainloop_id) {

            this.show_tasks_mainloop_id = null;
            return;
        }

        this.delegate.tasks_viewport[i].actor.visible = true;

        this.show_tasks_mainloop_id = Mainloop.idle_add(() => {
            this._show_tasks__finish(++i, scroll_bar_shown);
        });
    },

    _hide_tasks: function () {
        if (this.show_tasks_mainloop_id) {
            Mainloop.source_remove(this.show_tasks_mainloop_id);
            this.show_tasks_mainloop_id = null;
        }

        for (let i = 0, len = this.delegate.tasks_viewport.length; i < len; i++)
            this.delegate.tasks_viewport[i].actor.visible = false;
    },
});
Signals.addSignalMethods(ViewManager.prototype);
