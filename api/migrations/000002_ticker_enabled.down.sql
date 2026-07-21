ALTER TABLE user_widgets RENAME COLUMN ticker_enabled TO visible;

ALTER SEQUENCE user_widgets_id_seq RENAME TO user_channels_id_seq;
ALTER INDEX user_widgets_pkey RENAME TO user_channels_pkey;
ALTER INDEX user_widgets_logto_sub_widget_type_key
    RENAME TO user_channels_logto_sub_channel_type_key;
