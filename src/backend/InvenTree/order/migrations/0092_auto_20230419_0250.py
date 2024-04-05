# Generated by Django 3.2.18 on 2023-04-19 02:50

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('common', '0018_projectcode'),
        ('order', '0091_auto_20230419_0037'),
    ]

    operations = [
        migrations.AddField(
            model_name='purchaseorder',
            name='project_code',
            field=models.ForeignKey(blank=True, help_text='Select project code for this order', null=True, on_delete=django.db.models.deletion.SET_NULL, to='common.projectcode', verbose_name='Project Code'),
        ),
        migrations.AddField(
            model_name='returnorder',
            name='project_code',
            field=models.ForeignKey(blank=True, help_text='Select project code for this order', null=True, on_delete=django.db.models.deletion.SET_NULL, to='common.projectcode', verbose_name='Project Code'),
        ),
        migrations.AddField(
            model_name='salesorder',
            name='project_code',
            field=models.ForeignKey(blank=True, help_text='Select project code for this order', null=True, on_delete=django.db.models.deletion.SET_NULL, to='common.projectcode', verbose_name='Project Code'),
        ),
    ]